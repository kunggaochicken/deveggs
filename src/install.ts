import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { BasketError } from "./basket.ts";
import { HOOK_ARGS } from "./scout.ts";

// `deveggs install` loads PREFERENCES.md into every session of a harness through its
// global instructions file, so no agent has to remember to read it. A harness that
// supports imports (Claude Code's `@path`) gets an import line; one that doesn't
// (Codex reads ~/.codex/AGENTS.md verbatim) gets the rendered preferences inline,
// which every `deveggs render` re-syncs. Either way the change sits between managed
// markers, so install is idempotent and uninstall undoes it exactly.
//
// Gemini CLI does have `@path` imports in GEMINI.md, but it only resolves them inside the
// importing file's project root, which for the global ~/.gemini/GEMINI.md is ~/.gemini
// itself unless HOME is a git repo, so an import of ~/.deveggs/PREFERENCES.md is refused. Antigravity reads the same
// ~/.gemini/GEMINI.md but uses its own `@[label](path)` include syntax. Inline text is
// the one form both load, so Gemini gets the codex treatment.
//
// Cursor has no file for global rules: its User Rules live in the app's settings
// (Cursor Settings → Rules → User Rules), so there's no Cursor harness here; see CURSOR_HINT.

export const HARNESSES = ["claude-code", "codex", "gemini"] as const;
export type Harness = (typeof HARNESSES)[number];

interface HarnessSpec {
  /** Folder whose presence means the harness is installed, relative to HOME. */
  home: string;
  /** Global instructions file, relative to HOME. */
  file: string;
  /** "import": an `@path` line the harness resolves itself; "inline": the preferences' text. */
  mode: "import" | "inline";
}

const SPECS: Record<Harness, HarnessSpec> = {
  "claude-code": { home: ".claude", file: join(".claude", "CLAUDE.md"), mode: "import" },
  codex: { home: ".codex", file: join(".codex", "AGENTS.md"), mode: "inline" },
  // Gemini CLI and Antigravity both read ~/.gemini/GEMINI.md.
  gemini: { home: ".gemini", file: join(".gemini", "GEMINI.md"), mode: "inline" },
};

/** What `install` (no --harness, or `all`) tells a developer who has Cursor, which keeps global rules only in its settings. */
export const CURSOR_HINT =
  "· cursor: no global rules file to write; paste the deveggs prompt (INSTALL.md) into Cursor Settings → Rules → User Rules";

const BEGIN_TAG = "<!-- deveggs:preferences:begin (managed by deveggs install; undo with deveggs uninstall)";
export const END = "<!-- deveggs:preferences:end -->";
const SECTION_BEGIN = "<!-- deveggs:begin -->";
const SECTION_END = "<!-- deveggs:end -->";

/**
 * What uninstall needs to undo install exactly, kept in the begin marker (base64 JSON, so
 * nothing in it can end the comment): which basket the block loads, the original text it
 * replaced, how many newlines it added in front of itself, and whether it created the file.
 */
export interface State {
  basket: string;
  restore?: string;
  pad?: number;
  created?: boolean;
}

export const beginMarker = (state: State): string =>
  `${BEGIN_TAG} state=${Buffer.from(JSON.stringify(state)).toString("base64")} -->`;

/** The block in a file, from its begin marker's line through its end marker's line. */
const BLOCK = /^<!-- deveggs:preferences:begin\b[^\n]*-->\n[\s\S]*?^<!-- deveggs:preferences:end -->\n?/m;

function stateOf(found: string): State | undefined {
  const encoded = /\bstate=([A-Za-z0-9+/=]+) -->/.exec(found.slice(0, found.indexOf("\n")))?.[1];
  if (!encoded) return undefined;
  try {
    const state = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as State;
    return typeof state.basket === "string" ? state : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The deveggs prompt's line (INSTALL.md) that asks the agent to read the file itself. It
 * stops before any `<!--` on the same line, so it never takes a marker with it.
 */
const READ_LINE = /^- Read `[^`\n]*PREFERENCES\.md`[^\n<]*at session start[^\n<]*(?:\n|(?=<)|$)/m;

/** The read line INSTALL.md's deveggs prompt holds. */
export const readLine = (preferences: string): string =>
  `- Read \`${preferences}\` at session start and follow it; it outranks harness-local memory.\n`;

export function parseHarness(value: string | undefined): Harness[] {
  if (value === undefined || value === "all") return [...HARNESSES];
  if ((HARNESSES as readonly string[]).includes(value)) return [value as Harness];
  throw new BasketError(`invalid --harness ${JSON.stringify(value)}; expected one of ${HARNESSES.join(", ")}, all`);
}

export const instructionsFile = (home: string, harness: Harness): string => join(home, SPECS[harness].file);

/**
 * A word Gemini CLI would import as a file (`@notes.md`, `@./x`, or Antigravity's `@[l](p)`):
 * an `@` after whitespace, followed by `.`, `/`, a letter or `[`. Like Gemini CLI, it skips
 * backtick code spans and fences (the first alternative), so code is copied as is.
 */
const GEMINI_IMPORT = /(`+)[\s\S]*?\1|(^|\s)@(?=[./A-Za-z[])/gm;

/**
 * Inline preferences for a harness without imports: outside code fences, headings nest
 * under the deveggs section and links relative to the basket become absolute so they
 * still resolve. A line that looks like a managed marker is defused so it can't end the block,
 * and for Gemini a word outside code that it would import gets a zero-width space after its `@`.
 */
function inline(text: string, basket: string, harness: Harness): string {
  return text
    .split(/^(```[^\n]*\n[\s\S]*?^```[^\n]*$)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/^(#{1,4}) /gm, "##$1 ")
            .replace(/\]\(([^)\s:#][^)\s:]*)\)/g, (match, path: string) => (isAbsolute(path) ? match : `](${join(basket, path)})`)),
    )
    .join("")
    .replace(harness === "gemini" ? GEMINI_IMPORT : /$^/, (match, code: string | undefined, before: string) => (code ? match : `${before}@\u200b`))
    .replace(/<!-- deveggs:preferences:/g, "<!-- deveggs:preferences​:")
    .trimEnd();
}

/** The managed block for a harness. Inline mode needs the rendered PREFERENCES.md. */
export function block(harness: Harness, state: State, rendered: string | undefined): string {
  const preferences = state.basket;
  if (SPECS[harness].mode === "import") {
    const lead = `- My deveggs preferences, imported below from \`${preferences}\` by deveggs install, load into every session. Follow them; they outrank harness-local memory.`;
    return `${beginMarker(state)}\n${lead}\n\n@${preferences}\n${END}\n`;
  }
  const lead = `- My deveggs preferences, copied below from \`${preferences}\` by deveggs install and re-synced by every deveggs render, load into every session. Follow them; they outrank harness-local memory.`;
  const body = rendered === undefined ? "_PREFERENCES.md isn't rendered yet; run deveggs render._" : inline(rendered, dirname(preferences), harness);
  return `${beginMarker(state)}\n${lead}\n\n${body}\n${END}\n`;
}

export interface Change {
  harness: Harness;
  file: string;
  /** What happened, for the developer: one line. */
  action: string;
  changed: boolean;
  /** The block written (install) or removed (uninstall). */
  block?: string;
}

/** Is a position inside the deveggs prompt section (deveggs:begin … deveggs:end)? */
function inSection(text: string, index: number): boolean {
  const begin = text.lastIndexOf(SECTION_BEGIN, index);
  return begin !== -1 && text.lastIndexOf(SECTION_END, index) < begin && text.indexOf(SECTION_END, index) !== -1;
}

/**
 * Put the block in a file's text. An existing block is replaced in place, keeping what it
 * needs to undo itself. Otherwise it replaces the deveggs prompt's read-at-session-start
 * line, then goes right after the deveggs section, then at the end of the file.
 */
export function withBlock(
  text: string,
  harness: Harness,
  preferences: string,
  rendered: string | undefined,
  created = false,
): { text: string; where: string; block: string } {
  const found = BLOCK.exec(text);
  if (found) {
    const managed = block(harness, { ...stateOf(found[0]), basket: preferences }, rendered);
    return { text: text.slice(0, found.index) + managed + text.slice(found.index + found[0].length), where: "updated the managed block", block: managed };
  }
  const base: State = { basket: preferences, ...(created && { created }) };
  const read = READ_LINE.exec(text);
  if (read && inSection(text, read.index)) {
    const managed = block(harness, { ...base, restore: read[0] }, rendered);
    return { text: text.slice(0, read.index) + managed + text.slice(read.index + read[0].length), where: "replaced the read-at-session-start line in the deveggs section", block: managed };
  }
  const end = text.indexOf(SECTION_END);
  if (end !== -1) {
    const after = text.indexOf("\n", end);
    const at = after === -1 ? text.length : after + 1;
    const pad = after === -1 ? "\n" : "";
    const managed = block(harness, { ...base, ...(pad && { pad: 1 }) }, rendered);
    return { text: `${text.slice(0, at)}${pad}${managed}${text.slice(at)}`, where: "added after the deveggs section", block: managed };
  }
  const sep = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  const managed = block(harness, { ...base, ...(sep && { pad: sep.length }) }, rendered);
  return { text: `${text}${sep}${managed}`, where: "appended", block: managed };
}

/** Take the block out of a file's text, giving back exactly what install changed. */
export function withoutBlock(text: string): { text: string; removed?: string; state?: State } {
  const found = BLOCK.exec(text);
  if (!found) return { text };
  const state = stateOf(found[0]);
  const start = found.index - (state?.pad ?? 0);
  const out = text.slice(0, start) + (state?.restore ?? "") + text.slice(found.index + found[0].length);
  return { text: out, removed: found[0], ...(state && { state }) };
}

// The scout hook: Claude Code also gets one managed UserPromptSubmit entry in
// ~/.claude/settings.json that runs `deveggs scout --hook` on every prompt (src/scout.ts).
// It is the second code-enforced piece: the block above guarantees the preferences load,
// the hook guarantees the ones that fit a prompt get noticed. Settings has no comments to
// hold markers, so the entry is found by its command containing `deveggs scout --hook`, and
// every other key and hook is left as it was.

/** Seconds Claude Code waits for the hook; the scout itself gives up after 25 s by default. */
export const SCOUT_HOOK_TIMEOUT = 30;

export const settingsFile = (home: string): string => join(home, ".claude", "settings.json");

/** The hook command for a deveggs checkout: `<repo>/bin/deveggs scout --hook`, quoted if needed. */
export function scoutCommand(repo: string): string {
  const bin = join(repo, "bin", "deveggs");
  return `${/^[\w@%+=:,./-]+$/.test(bin) ? bin : `'${bin.replace(/'/g, `'\\''`)}'`} ${HOOK_ARGS}`;
}

const isScout = (h: unknown): boolean =>
  !!h && typeof h === "object" && typeof (h as { command?: unknown }).command === "string" && /\bdeveggs'? scout --hook\b/.test((h as { command: string }).command);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** The indent a JSON file uses, so a rewrite keeps its look. */
const indentOf = (text: string): string | number => /^\{\n([ \t]+)"/.exec(text)?.[1] ?? 2;

/**
 * Settings with the scout hook in `hooks.UserPromptSubmit`: an existing entry is updated in
 * place (a moved checkout), otherwise one group is appended after the others.
 */
export function withScoutHook(settings: Json, command: string): { settings: Json; where: string } {
  const out = structuredClone(settings);
  const hooks = isObject(out["hooks"]) ? out["hooks"] : (out["hooks"] = {});
  if (!isObject(hooks)) throw new BasketError("settings.json hooks isn't an object");
  const groups = Array.isArray(hooks["UserPromptSubmit"]) ? (hooks["UserPromptSubmit"] as unknown[]) : (hooks["UserPromptSubmit"] = []);
  const entry = { type: "command", command, timeout: SCOUT_HOOK_TIMEOUT };
  for (const g of groups) {
    const list = isObject(g) && Array.isArray(g["hooks"]) ? (g["hooks"] as unknown[]) : [];
    const at = list.findIndex(isScout);
    if (at !== -1) {
      list[at] = { ...(list[at] as Json), ...entry };
      return { settings: out, where: "updated the scout hook" };
    }
  }
  (groups as unknown[]).push({ hooks: [entry] });
  return { settings: out, where: "added a UserPromptSubmit hook" };
}

/** Settings without the scout hook, dropping a group, array or hooks object it leaves empty. */
export function withoutScoutHook(settings: Json): { settings: Json; removed: unknown[] } {
  const out = structuredClone(settings);
  const removed: unknown[] = [];
  const hooks = out["hooks"];
  if (!isObject(hooks) || !Array.isArray(hooks["UserPromptSubmit"])) return { settings: out, removed };
  const groups = (hooks["UserPromptSubmit"] as unknown[]).filter((g) => {
    if (!isObject(g) || !Array.isArray(g["hooks"])) return true;
    const list = g["hooks"] as unknown[];
    const kept = list.filter((h) => !isScout(h));
    if (kept.length === list.length) return true;
    removed.push(...list.filter(isScout));
    g["hooks"] = kept;
    return kept.length > 0;
  });
  if (!removed.length) return { settings, removed };
  if (groups.length) hooks["UserPromptSubmit"] = groups;
  else delete hooks["UserPromptSubmit"];
  if (!Object.keys(hooks).length) delete out["hooks"];
  return { settings: out, removed };
}

function readSettings(file: string): { text: string; settings?: Json } {
  if (!existsSync(file)) return { text: "", settings: {} };
  const text = readFileSync(file, "utf8");
  if (!text.trim()) return { text, settings: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? { text, settings: parsed } : { text };
  } catch {
    return { text };
  }
}

const writeJson = (settings: Json, before: string): string => `${JSON.stringify(settings, null, indentOf(before))}\n`;

function installHook(opts: Options, command: string): Change {
  const harness: Harness = "claude-code";
  const file = settingsFile(opts.home);
  const { text: before, settings } = readSettings(file);
  if (!settings) return { harness, file, action: "skipped the scout hook: settings.json isn't a JSON object; add it by hand (INSTALL.md)", changed: false };
  const { settings: next, where } = withScoutHook(settings, command);
  const text = writeJson(next, before);
  const shown = JSON.stringify({ type: "command", command, timeout: SCOUT_HOOK_TIMEOUT });
  if (JSON.stringify(next) === JSON.stringify(settings)) return { harness, file, action: "scout hook already installed; nothing changed", changed: false, block: shown };
  if (!opts.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return { harness, file, action: `${opts.dryRun ? "would install" : "installed"}: scout hook (hooks.UserPromptSubmit runs ${command}); ${where}`, changed: true, block: shown };
}

function uninstallHook(opts: Options): Change {
  const harness: Harness = "claude-code";
  const file = settingsFile(opts.home);
  const { text: before, settings } = readSettings(file);
  const { settings: next, removed } = settings ? withoutScoutHook(settings) : { settings: {}, removed: [] };
  if (!settings || !removed.length) return { harness, file, action: "scout hook not installed; nothing changed", changed: false };
  // Nothing left means install created the file (or it held only {}): take it away again.
  const empty = !Object.keys(next).length;
  if (!opts.dryRun) {
    if (empty) rmSync(file);
    else writeFileSync(file, writeJson(next, before));
  }
  return { harness, file, action: `${opts.dryRun ? "would remove" : "removed"} the scout hook${empty ? "; deleted the settings file it left empty" : ""}`, changed: true, block: removed.map((h) => JSON.stringify(h)).join("\n") };
}

interface Options {
  home: string;
  /** The scout hook's command (Claude Code only); no hook when absent. */
  scout?: string | undefined;
  preferences: string;
  dryRun: boolean;
  /** Harnesses named explicitly are wired even before their home folder exists. */
  explicit: boolean;
  /** The rendered preferences, when they aren't on disk yet (a dry run). */
  rendered?: string | undefined;
}

function readRendered(preferences: string): string | undefined {
  return existsSync(preferences) ? readFileSync(preferences, "utf8") : undefined;
}

export function install(harnesses: Harness[], opts: Options): Change[] {
  const rendered = opts.rendered ?? readRendered(opts.preferences);
  return harnesses.flatMap((harness) => {
    const change = installBlock(harness, opts, rendered);
    return harness === "claude-code" && opts.scout !== undefined && !change.action.startsWith("skipped") ? [change, installHook(opts, opts.scout)] : [change];
  });
}

function installBlock(harness: Harness, opts: Options, rendered: string | undefined): Change {
  const file = instructionsFile(opts.home, harness);
  if (!opts.explicit && !existsSync(join(opts.home, SPECS[harness].home))) {
    return { harness, file, action: `skipped: not installed (no ~/${SPECS[harness].home})`, changed: false };
  }
  const exists = existsSync(file);
  const before = exists ? readFileSync(file, "utf8") : "";
  const { text, where, block: managed } = withBlock(before, harness, opts.preferences, rendered, !exists);
  if (text === before) return { harness, file, action: "already installed; nothing changed", changed: false, block: managed };
  if (!opts.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const how = SPECS[harness].mode === "import" ? `imports ${opts.preferences}` : `copies ${opts.preferences} inline (re-synced by deveggs render)`;
  return { harness, file, action: `${opts.dryRun ? "would install" : "installed"}: ${how}; ${where}`, changed: true, block: managed };
}

export function uninstall(harnesses: Harness[], opts: Options): Change[] {
  return harnesses.flatMap((harness) => (harness === "claude-code" ? [uninstallBlock(harness, opts), uninstallHook(opts)] : [uninstallBlock(harness, opts)]));
}

function uninstallBlock(harness: Harness, opts: Options): Change {
  const file = instructionsFile(opts.home, harness);
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const { text, removed, state } = withoutBlock(before);
  if (removed === undefined) return { harness, file, action: "not installed; nothing changed", changed: false };
  const remove = state?.created === true && text === "";
  if (!opts.dryRun) {
    if (remove) rmSync(file);
    else writeFileSync(file, text);
  }
  const what = remove ? "; deleted the file it created" : state?.restore ? "; restored the line it replaced" : "";
  return { harness, file, action: `${opts.dryRun ? "would remove" : "removed"} the managed block${what}`, changed: true, block: removed };
}

/**
 * Re-sync every inline block installed from this basket with its freshly rendered
 * preferences. Never adds a block. Returns the files it rewrote.
 */
export function sync(home: string, preferences: string): string[] {
  const rendered = readRendered(preferences);
  const synced: string[] = [];
  for (const harness of HARNESSES) {
    if (SPECS[harness].mode !== "inline") continue;
    const file = instructionsFile(home, harness);
    if (!existsSync(file)) continue;
    const before = readFileSync(file, "utf8");
    const found = BLOCK.exec(before);
    // Only the basket it was installed from: a scratch basket ($DEVEGGS_BASKET) never overwrites it.
    const state = found ? stateOf(found[0]) : undefined;
    if (!found || state?.basket !== preferences) continue;
    const { text } = withBlock(before, harness, preferences, rendered);
    if (text === before) continue;
    writeFileSync(file, text);
    synced.push(file);
  }
  return synced;
}
