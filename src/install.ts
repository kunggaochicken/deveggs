import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { BasketError } from "./basket.ts";
import { CHECKERS, HOOK_ARGS, SCOUT_AGENTS, type ScoutAgent, type ScoutDefault, type ScoutHarness } from "./scout.ts";

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

/** How messages name a harness. */
export const HARNESS_NAMES: Record<Harness, string> = { "claude-code": "Claude Code", codex: "Codex", gemini: "Gemini" };

/** Seconds Claude Code and Codex wait for the scout hook (both read `timeout` in seconds); the scout itself gives up after 12 s by default. */
export const SCOUT_HOOK_TIMEOUT = 15;

interface HarnessSpec {
  /** Folder whose presence means the harness is installed, relative to HOME. */
  home: string;
  /** Global instructions file, relative to HOME. */
  file: string;
  /** "import": an `@path` line the harness resolves itself; "inline": the preferences' text. */
  mode: "import" | "inline";
  /** The harness's own prompt-submit hook that runs the scout, when it has one that can inject context. */
  hook?: HookSpec;
}

/**
 * Where a harness keeps its prompt hooks. "nested" (Claude Code, Codex):
 * `{hooks: {<event>: [{hooks: [entry]}]}}`. "named" (Antigravity): `{<name>: {<event>: [entry]}}`.
 */
interface HookSpec {
  harness: ScoutHarness;
  /** Hooks file, relative to HOME. */
  file: string;
  event: "UserPromptSubmit" | "PreInvocation";
  shape: "nested" | "named";
  /** Seconds the harness waits for the hook; the scout itself gives up after 12 s by default. */
  timeout: number;
  /** Said after a hook is installed or changed, when the harness needs the developer to act. */
  after?: string;
  /** Paths (relative to HOME) whose presence means this hook's harness is installed; always installed when absent. */
  present?: string[];
  /** The harness has no isolated headless mode, so its scout borrows the default scout agent's checker. */
  borrows?: true;
}

const SPECS: Record<Harness, HarnessSpec> = {
  "claude-code": {
    home: ".claude",
    file: join(".claude", "CLAUDE.md"),
    mode: "import",
    hook: { harness: "claude-code", file: join(".claude", "settings.json"), event: "UserPromptSubmit", shape: "nested", timeout: SCOUT_HOOK_TIMEOUT },
  },
  codex: {
    home: ".codex",
    file: join(".codex", "AGENTS.md"),
    mode: "inline",
    // Codex skips a new or changed hook until the developer trusts it (its hash, kept in config.toml).
    hook: {
      harness: "codex",
      file: join(".codex", "hooks.json"),
      event: "UserPromptSubmit",
      shape: "nested",
      timeout: SCOUT_HOOK_TIMEOUT,
      after: "Codex runs it once you trust it: start codex and review it in /hooks",
    },
  },
  // Gemini CLI and Antigravity both read ~/.gemini/GEMINI.md. Antigravity's PreInvocation hook
  // can inject context but `agy -p` can't run isolated (every run is saved as a conversation and
  // runs hooks), so its scout hook borrows the default scout agent's checker. Gemini CLI: see SCOUT_NOTES.
  gemini: {
    home: ".gemini",
    file: join(".gemini", "GEMINI.md"),
    mode: "inline",
    hook: {
      harness: "antigravity",
      file: join(".gemini", "config", "hooks.json"),
      event: "PreInvocation",
      shape: "named",
      timeout: SCOUT_HOOK_TIMEOUT,
      present: [join(".gemini", "antigravity-cli"), join(".gemini", "antigravity"), join(".gemini", "config")],
      borrows: true,
    },
  },
};

/** How messages name the harness a scout hook runs in. */
export const SCOUT_HARNESS_NAMES: Record<ScoutHarness, string> = { "claude-code": "Claude Code", codex: "Codex", antigravity: "Antigravity" };

/**
 * What install says about a harness's scout beyond its hook. Gemini CLI's BeforeAgent hook
 * is documented, but not whether hooks need enabling or what its transcript looks like, it
 * isn't installed here to test, and Antigravity CLI replaced it.
 */
export const SCOUT_NOTES: Partial<Record<Harness, string>> = {
  gemini: "· gemini: Gemini CLI has no scout hook yet (its BeforeAgent hook is untested here); preferences still load from GEMINI.md",
};

/** What `install` (no --harness, or `all`) tells a developer who has Cursor, which keeps global rules only in its settings. */
export const CURSOR_HINT =
  "· cursor: no global rules file to write; paste the deveggs prompt (INSTALL.md) into Cursor Settings → Rules → User Rules. No scout hook: Cursor's beforeSubmitPrompt hook can't add context, so not even the default scout agent can help it";

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
  /** Set on a scout hook change (rather than an instructions block). */
  hook?: true;
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

// The scout hook: each harness with a prompt-submit hook that can inject context (SPECS'
// `hook`) also gets one managed UserPromptSubmit entry that runs `deveggs scout --hook
// --harness <it>` on every prompt (src/scout.ts): Claude Code in ~/.claude/settings.json,
// Codex in ~/.codex/hooks.json, both the same JSON shape. It is the second code-enforced
// piece: the block above guarantees the preferences load, the hook guarantees the ones
// that fit a prompt get noticed. JSON has no comments to hold markers, so the entry is
// found by its command containing `deveggs scout --hook`, and every other key and hook is
// left as it was.

/**
 * The hook command for a deveggs checkout: `<repo>/bin/deveggs scout --hook --harness <h>`,
 * quoted if needed. The harness is named explicitly, so the scout never guesses which CLI
 * to ask. Its stderr is dropped and it always exits 0, so even a checkout that's gone (or
 * no node on the hook's PATH) never shows the developer a hook error: fail open outside
 * the process too.
 */
export function scoutCommand(repo: string, harness?: ScoutHarness): string {
  const bin = join(repo, "bin", "deveggs");
  return `${/^[\w@%+=:,./-]+$/.test(bin) ? bin : `'${bin.replace(/'/g, `'\\''`)}'`} ${HOOK_ARGS}${harness ? ` --harness ${harness}` : ""} 2>/dev/null || true`;
}

const isScout = (h: unknown): boolean =>
  !!h && typeof h === "object" && typeof (h as { command?: unknown }).command === "string" && /(^|[/\s'])deveggs'? scout --hook(\s|$)/.test((h as { command: string }).command);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** The indent a JSON file uses, so a rewrite keeps its look. */
const indentOf = (text: string): string | number => /^\{\n([ \t]+)"/.exec(text)?.[1] ?? 2;

/**
 * Settings with the scout hook in `hooks.UserPromptSubmit`: an existing entry is updated in
 * place (a moved checkout), otherwise one group is appended after the others (so, in
 * Codex, the trust it keeps per hook position stays with every other hook).
 */
export function withScoutHook(settings: Json, command: string, timeout = SCOUT_HOOK_TIMEOUT): { settings: Json; where: string } | undefined {
  const out = structuredClone(settings);
  // Create what's missing, but never replace a value of the wrong shape: that's the developer's.
  if (out["hooks"] === undefined) out["hooks"] = {};
  const hooks = out["hooks"];
  if (!isObject(hooks)) return undefined;
  if (hooks["UserPromptSubmit"] === undefined) hooks["UserPromptSubmit"] = [];
  const groups = hooks["UserPromptSubmit"];
  if (!Array.isArray(groups)) return undefined;
  const entry = { type: "command", command, timeout };
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

/** The key deveggs owns in Antigravity's hooks.json, which maps hook names to their events. */
export const NAMED_HOOK = "deveggs-scout";

/**
 * Antigravity hooks with the scout hook in `deveggs-scout.<event>` (its own name, so every
 * other named hook stays as it was); an existing entry is updated in place.
 */
export function withNamedScoutHook(settings: Json, command: string, timeout = SCOUT_HOOK_TIMEOUT, event = "PreInvocation"): { settings: Json; where: string } | undefined {
  const out = structuredClone(settings);
  if (out[NAMED_HOOK] === undefined) out[NAMED_HOOK] = {};
  const named = out[NAMED_HOOK];
  if (!isObject(named)) return undefined;
  if (named[event] === undefined) named[event] = [];
  const list = named[event];
  if (!Array.isArray(list)) return undefined;
  const entry = { type: "command", command, timeout };
  const at = list.findIndex(isScout);
  if (at !== -1) {
    list[at] = { ...(list[at] as Json), ...entry };
    return { settings: out, where: "updated the scout hook" };
  }
  list.push(entry);
  return { settings: out, where: `added a ${event} hook named ${NAMED_HOOK}` };
}

/** Antigravity hooks without the scout hook, dropping the `deveggs-scout` name once it holds nothing else. */
export function withoutNamedScoutHook(settings: Json, event = "PreInvocation"): { settings: Json; removed: unknown[] } {
  const out = structuredClone(settings);
  const named = out[NAMED_HOOK];
  if (!isObject(named) || !Array.isArray(named[event])) return { settings, removed: [] };
  const list = named[event] as unknown[];
  const removed = list.filter(isScout);
  if (!removed.length) return { settings, removed };
  const kept = list.filter((h) => !isScout(h));
  if (kept.length) named[event] = kept;
  else delete named[event];
  if (Object.keys(named).every((k) => k === "enabled")) delete out[NAMED_HOOK];
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

/** Write through a temp file and rename, so a harness never reads a half-written hooks file. */
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.deveggs-${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** "scout hook", naming the harness where the file alone doesn't (Antigravity shares ~/.gemini with Gemini CLI). */
const hookLabel = (hook: HookSpec): string => (hook.borrows ? `${SCOUT_HARNESS_NAMES[hook.harness]} scout hook` : "scout hook");

/** Is this hook's harness installed? A hook with `present` paths (Antigravity, which shares ~/.gemini with Gemini CLI) needs one of them, even when its harness is named. */
const hookPresent = (hook: HookSpec, home: string): boolean =>
  !hook.present || hook.present.some((p) => existsSync(join(home, p)));

/** The checker a borrowing hook runs, for messages. */
const borrowedChecker = (choice: Options["scoutDefault"]): string =>
  choice === "ask" ? "the default scout agent you pick" : choice && choice !== "none" ? `the default scout agent, ${choice} (${CHECKERS[choice].name})` : "no default scout agent";

function installHook(harness: Harness, hook: HookSpec, opts: Options, repo: string): Change | undefined {
  const file = join(opts.home, hook.file);
  const name = basename(file);
  const label = hookLabel(hook);
  if (!hookPresent(hook, opts.home)) return undefined;
  if (hook.borrows && (opts.scoutDefault === undefined || opts.scoutDefault === "none")) {
    // Opting out takes away a hook an earlier install added: with no checker it would only log errors.
    const removed = opts.scoutDefault === "none" ? uninstallHook(harness, hook, opts) : undefined;
    if (removed?.changed) return { ...removed, action: `${removed.action}: the default scout agent is now none` };
    const why = opts.scoutDefault === "none" ? "the default scout agent is none" : "no default scout agent (claude or codex) to check with";
    return { harness, file, action: `skipped the ${label}: ${why}; it has no isolated headless mode of its own`, changed: false, hook: true };
  }
  const command = scoutCommand(repo, hook.harness);
  const { text: before, settings } = readSettings(file);
  if (!settings) return { harness, file, action: `skipped the ${label}: ${name} isn't a JSON object; add it by hand (INSTALL.md)`, changed: false, hook: true };
  const hooked = hook.shape === "named" ? withNamedScoutHook(settings, command, hook.timeout, hook.event) : withScoutHook(settings, command, hook.timeout);
  const where = hook.shape === "named" ? `${NAMED_HOOK} or ${NAMED_HOOK}.${hook.event}` : `hooks or hooks.${hook.event}`;
  if (!hooked) return { harness, file, action: `skipped the ${label}: ${name} ${where} has an unexpected shape; add it by hand (INSTALL.md)`, changed: false, hook: true };
  const { settings: next, where: did } = hooked;
  const text = writeJson(next, before);
  const shown = JSON.stringify({ type: "command", command, timeout: hook.timeout });
  const checks = hook.borrows ? `; checks with ${borrowedChecker(opts.scoutDefault)}` : "";
  if (JSON.stringify(next) === JSON.stringify(settings)) return { harness, file, action: `${label} already installed${checks}; nothing changed`, changed: false, block: shown, hook: true };
  if (!opts.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeAtomic(file, text);
  }
  const after = hook.after ? `. ${hook.after}` : "";
  const at = hook.shape === "named" ? `${NAMED_HOOK}.${hook.event}` : `hooks.${hook.event}`;
  return { harness, file, action: `${opts.dryRun ? "would install" : "installed"}: ${label} (${at} runs ${command})${checks}; ${did}${after}`, changed: true, block: shown, hook: true };
}

function uninstallHook(harness: Harness, hook: HookSpec, opts: Options): Change {
  const file = join(opts.home, hook.file);
  const label = hookLabel(hook);
  const { text: before, settings } = readSettings(file);
  const without = hook.shape === "named" ? withoutNamedScoutHook : withoutScoutHook;
  const { settings: next, removed } = settings ? without(settings) : { settings: {}, removed: [] };
  if (!settings || !removed.length) return { harness, file, action: `${label} not installed; nothing changed`, changed: false, hook: true };
  // Nothing left means install created the file (or it held only {}): take it away again.
  const empty = !Object.keys(next).length;
  if (!opts.dryRun) {
    if (empty) rmSync(file);
    else writeAtomic(file, writeJson(next, before));
  }
  return { harness, file, action: `${opts.dryRun ? "would remove" : "removed"} the ${label}${empty ? `; deleted the ${basename(file)} it left empty` : ""}`, changed: true, block: removed.map((h) => JSON.stringify(h)).join("\n"), hook: true };
}

interface Options {
  home: string;
  /** The deveggs checkout the scout hooks run; no hooks when absent. */
  repo?: string | undefined;
  preferences: string;
  dryRun: boolean;
  /** Harnesses named explicitly are wired even before their home folder exists. */
  explicit: boolean;
  /** The rendered preferences, when they aren't on disk yet (a dry run). */
  rendered?: string | undefined;
  /** The default scout agent borrowing hooks check with; "ask" in a dry run that would prompt for it. */
  scoutDefault?: ScoutDefault | "ask" | undefined;
}

function readRendered(preferences: string): string | undefined {
  return existsSync(preferences) ? readFileSync(preferences, "utf8") : undefined;
}

export function install(harnesses: Harness[], opts: Options): Change[] {
  const rendered = opts.rendered ?? readRendered(opts.preferences);
  return harnesses.flatMap((harness) => {
    const change = installBlock(harness, opts, rendered);
    const hook = SPECS[harness].hook;
    const hooked = hook && opts.repo !== undefined && !change.action.startsWith("skipped") ? installHook(harness, hook, opts, opts.repo) : undefined;
    return hooked ? [change, hooked] : [change];
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
  return harnesses.flatMap((harness) => {
    const hook = SPECS[harness].hook;
    const skip = hook && !hookPresent(hook, opts.home) && !existsSync(join(opts.home, hook.file));
    return hook && !skip ? [uninstallBlock(harness, opts), uninstallHook(harness, hook, opts)] : [uninstallBlock(harness, opts)];
  });
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

// The default scout agent. A harness whose hook can inject context but that has no isolated
// headless mode (Antigravity) borrows another agent's checker; `deveggs install` asks the
// developer which, once per machine, and saves it (src/store.ts).

/** The harnesses being installed whose scout hook would borrow the default agent, by name. */
export function borrowingHarnesses(harnesses: Harness[], home: string, explicit: boolean): string[] {
  return harnesses.flatMap((h) => {
    const hook = SPECS[h].hook;
    const installed = explicit || existsSync(join(home, SPECS[h].home));
    return hook?.borrows && installed && hookPresent(hook, home) ? [SCOUT_HARNESS_NAMES[hook.harness]] : [];
  });
}

/** Does uninstalling these harnesses remove every hook that borrows the default agent? */
export const uninstallsBorrowers = (harnesses: Harness[]): boolean =>
  (Object.keys(SPECS) as Harness[]).filter((h) => SPECS[h].hook?.borrows).every((h) => harnesses.includes(h));

export interface AgentCandidate {
  agent: ScoutAgent;
  /** The headless command it runs, e.g. `claude -p`. */
  checker: string;
  /** Signed in, as far as an API key or its login file cheaply tells (never runs the CLI). */
  signedIn: boolean;
}

const BINARIES: Record<ScoutAgent, string> = { "claude-code": "claude", codex: "codex" };

function onPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, bin);
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      // not here
    }
  }
  return false;
}

/** Cheap sign-in hints: an API key, or the login file each CLI keeps. Never runs the CLI. */
function signedIn(agent: ScoutAgent, env: NodeJS.ProcessEnv, home: string): boolean {
  if (agent === "claude-code") {
    if (env["ANTHROPIC_API_KEY"]) return true;
    try {
      return /"oauthAccount"\s*:\s*\{/.test(readFileSync(join(home, ".claude.json"), "utf8"));
    } catch {
      return false;
    }
  }
  return !!env["OPENAI_API_KEY"] || !!env["CODEX_API_KEY"] || existsSync(join(env["CODEX_HOME"] || join(home, ".codex"), "auth.json"));
}

/** The agents whose headless CLI is on PATH, in SCOUT_AGENTS order. */
export function scoutCandidates(env: NodeJS.ProcessEnv, home: string): AgentCandidate[] {
  return SCOUT_AGENTS.filter((a) => onPath(BINARIES[a], env)).map((agent) => ({ agent, checker: CHECKERS[agent].name, signedIn: signedIn(agent, env, home) }));
}

/** The first signed-in candidate, else the first found. */
export const recommendedAgent = (candidates: AgentCandidate[]): AgentCandidate | undefined => candidates.find((c) => c.signedIn) ?? candidates[0];

const describe = (c: AgentCandidate, rec: AgentCandidate | undefined): string =>
  `${c.agent} (${c.checker}${c.signedIn ? ", signed in" : ""}${c === rec ? ", recommended" : ""})`;

/** One line for an agent that runs install without a terminal: ask the developer, then rerun with the flag. */
export function needsInputMessage(borrowers: string[], candidates: AgentCandidate[]): string {
  const rec = recommendedAgent(candidates);
  return `needs input: ${borrowers.join(" and ")} has no isolated headless mode, so its scout hook borrows a default scout agent. Ask the developer which to use (found: ${candidates.map((c) => describe(c, rec)).join(", ")}; or none), then rerun: deveggs install --scout-default <${SCOUT_AGENTS.join("|")}|none>`;
}

/** What a dry run says about a default it would ask for. */
export const wouldAskLine = (borrowers: string[], candidates: AgentCandidate[]): string => {
  const rec = recommendedAgent(candidates);
  return candidates.length
    ? `🔭 default scout agent: not set; install will ask, for ${borrowers.join(" and ")} (found: ${candidates.map((c) => describe(c, rec)).join(", ")}; or none)`
    : `🔭 default scout agent: none found (no claude or codex on PATH), so ${borrowers.join(" and ")} would get no scout hook`;
};

/**
 * Ask the developer for the default scout agent at a terminal. Lists each candidate, marks
 * the recommended one, and takes Enter for it; a number or name picks another, "none" opts out.
 * With no candidates it explains and returns undefined without asking.
 */
export function promptScoutDefault(
  borrowers: string[],
  candidates: AgentCandidate[],
  ask: (question: string) => string,
  say: (line: string) => void,
): ScoutDefault | undefined {
  const who = borrowers.join(" and ");
  if (!candidates.length) {
    say(`🔭 Default scout agent: neither claude nor codex is on your PATH, so ${who} gets no scout hook (it has no isolated headless mode of its own). Your preferences still load at session start.`);
    return undefined;
  }
  const rec = recommendedAgent(candidates) as AgentCandidate;
  const options: ScoutDefault[] = [...candidates.map((c) => c.agent), "none"];
  say(`🔭 Default scout agent: ${who} has no isolated headless mode, so its scout hook borrows one of these to check each prompt in a fresh context:`);
  candidates.forEach((c, i) => say(`   ${i + 1}) ${c.agent.padEnd(11)} ${c.checker.padEnd(10)} ${c.signedIn ? "signed in" : "sign-in not detected"}${c === rec ? "   ← recommended" : ""}`));
  say(`   ${options.length}) none        no scout in ${who}; your preferences still load at session start`);
  const def = options.indexOf(rec.agent) + 1;
  for (let tries = 0; tries < 3; tries++) {
    const answer = ask(`   Pick 1-${options.length} [${def}]: `).trim().toLowerCase();
    if (!answer) return rec.agent;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
    const named = options.find((o) => o === answer || (o === "claude-code" && answer === "claude"));
    if (named) return named;
    say(`   "${answer}" isn't one of them.`);
  }
  throw new BasketError(`no default scout agent picked; rerun deveggs install, or pass --scout-default <${SCOUT_AGENTS.join("|")}|none>`);
}
