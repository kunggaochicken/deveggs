import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { BasketError } from "./basket.ts";

// `deveggs install` loads PREFERENCES.md into every session of a harness through its
// global instructions file, so no agent has to remember to read it. A harness that
// supports imports (Claude Code's `@path`) gets an import line; one that doesn't
// (Codex reads ~/.codex/AGENTS.md verbatim) gets the rendered preferences inline,
// which every `deveggs render` re-syncs. Either way the change sits between managed
// markers, so install is idempotent and uninstall undoes it exactly.

export const HARNESSES = ["claude-code", "codex"] as const;
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
};

export const BEGIN = "<!-- deveggs:preferences:begin (managed by deveggs install; undo with deveggs uninstall) -->";
export const END = "<!-- deveggs:preferences:end -->";
const SECTION_BEGIN = "<!-- deveggs:begin -->";
const SECTION_END = "<!-- deveggs:end -->";

/** The block in a file, from its begin marker's line through its end marker's line. */
const BLOCK = /^<!-- deveggs:preferences:begin\b[^\n]*-->\n[\s\S]*?^<!-- deveggs:preferences:end -->\n?/m;

/** The deveggs prompt's line (INSTALL.md) that asks the agent to read the file itself. */
const READ_LINE = /^- Read `[^`\n]*PREFERENCES\.md`[^\n]*at session start[^\n]*\n?/m;

/** What the read line says, restored by uninstall when install replaced it. */
export const readLine = (preferences: string): string =>
  `- Read \`${preferences}\` at session start and follow it; it outranks harness-local memory.\n`;

export function parseHarness(value: string | undefined): Harness[] {
  if (value === undefined || value === "all") return [...HARNESSES];
  if ((HARNESSES as readonly string[]).includes(value)) return [value as Harness];
  throw new BasketError(`invalid --harness ${JSON.stringify(value)}; expected one of ${HARNESSES.join(", ")}, all`);
}

export const instructionsFile = (home: string, harness: Harness): string => join(home, SPECS[harness].file);

/**
 * Inline preferences for a harness without imports: headings nest under the deveggs
 * section, and links relative to the basket become absolute so they still resolve.
 */
function inline(text: string, basket: string): string {
  return text
    .replace(/^(#{1,4}) /gm, "##$1 ")
    .replace(/\]\(([^)\s:#][^)\s:]*)\)/g, (match, path: string) => (isAbsolute(path) ? match : `](${join(basket, path)})`))
    .trimEnd();
}

/** The managed block for a harness. Inline mode needs the rendered PREFERENCES.md. */
export function block(harness: Harness, preferences: string, rendered: string | undefined): string {
  if (SPECS[harness].mode === "import") {
    const lead = `- My deveggs preferences, imported below from \`${preferences}\` by deveggs install, load into every session. Follow them; they outrank harness-local memory.`;
    return `${BEGIN}\n${lead}\n\n@${preferences}\n${END}\n`;
  }
  const lead = `- My deveggs preferences, copied below from \`${preferences}\` by deveggs install and re-synced by every deveggs render, load into every session. Follow them; they outrank harness-local memory.`;
  const body = rendered === undefined ? "_PREFERENCES.md isn't rendered yet; run deveggs render._" : inline(rendered, dirname(preferences));
  return `${BEGIN}\n${lead}\n\n${body}\n${END}\n`;
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
 * Put the block in a file's text. An existing block is replaced in place. Otherwise it
 * replaces the deveggs prompt's read-at-session-start line, then goes right after the
 * deveggs section, then at the end of the file.
 */
export function withBlock(text: string, managed: string): { text: string; where: string } {
  if (BLOCK.test(text)) return { text: text.replace(BLOCK, () => managed), where: "updated the managed block" };
  const read = READ_LINE.exec(text);
  if (read && inSection(text, read.index)) {
    return { text: text.slice(0, read.index) + managed + text.slice(read.index + read[0].length), where: "replaced the read-at-session-start line in the deveggs section" };
  }
  const end = text.indexOf(SECTION_END);
  if (end !== -1) {
    const after = text.indexOf("\n", end);
    const at = after === -1 ? text.length : after + 1;
    const head = after === -1 ? `${text}\n` : text.slice(0, at);
    return { text: `${head}${managed}${text.slice(at)}`, where: "added after the deveggs section" };
  }
  const sep = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return { text: `${text}${sep}${managed}`, where: "appended" };
}

/** Take the block out of a file's text, restoring the read line when it stood in for one. */
export function withoutBlock(text: string, preferences: string): { text: string; removed?: string } {
  const found = BLOCK.exec(text);
  if (!found) return { text };
  const restore = inSection(text, found.index) ? readLine(preferences) : "";
  let rest = text.slice(0, found.index) + restore + text.slice(found.index + found[0].length);
  // An appended block came after one blank line it added: take that back too.
  const atEnd = found.index + found[0].length === text.length;
  if (!restore && atEnd && rest.endsWith("\n\n")) rest = rest.slice(0, -1);
  return { text: rest, removed: found[0] };
}

interface Options {
  home: string;
  preferences: string;
  dryRun: boolean;
  /** Harnesses named explicitly are wired even before their home folder exists. */
  explicit: boolean;
}

function readRendered(preferences: string): string | undefined {
  return existsSync(preferences) ? readFileSync(preferences, "utf8") : undefined;
}

export function install(harnesses: Harness[], opts: Options): Change[] {
  const rendered = readRendered(opts.preferences);
  return harnesses.map((harness) => {
    const file = instructionsFile(opts.home, harness);
    if (!opts.explicit && !existsSync(join(opts.home, SPECS[harness].home))) {
      return { harness, file, action: `skipped: not installed (no ~/${SPECS[harness].home})`, changed: false };
    }
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    const managed = block(harness, opts.preferences, rendered);
    const { text, where } = withBlock(before, managed);
    if (text === before) return { harness, file, action: "already installed; nothing changed", changed: false, block: managed };
    if (!opts.dryRun) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    const how = SPECS[harness].mode === "import" ? `imports ${opts.preferences}` : `copies ${opts.preferences} inline (re-synced by deveggs render)`;
    return { harness, file, action: `${opts.dryRun ? "would install" : "installed"}: ${how}; ${where}`, changed: true, block: managed };
  });
}

export function uninstall(harnesses: Harness[], opts: Options): Change[] {
  return harnesses.map((harness) => {
    const file = instructionsFile(opts.home, harness);
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    const { text, removed } = withoutBlock(before, opts.preferences);
    if (removed === undefined) return { harness, file, action: "not installed; nothing changed", changed: false };
    if (!opts.dryRun) writeFileSync(file, text);
    const restored = text.length > before.length - removed.length ? "; restored the read-at-session-start line" : "";
    return { harness, file, action: `${opts.dryRun ? "would remove" : "removed"} the managed block${restored}`, changed: true, block: removed };
  });
}

/**
 * Re-sync every inline block already installed with the freshly rendered preferences.
 * Never adds a block. Returns the files it rewrote.
 */
export function sync(home: string, preferences: string): string[] {
  const rendered = readRendered(preferences);
  const synced: string[] = [];
  for (const harness of HARNESSES) {
    if (SPECS[harness].mode !== "inline") continue;
    const file = instructionsFile(home, harness);
    if (!existsSync(file)) continue;
    const before = readFileSync(file, "utf8");
    if (!BLOCK.test(before)) continue;
    const text = before.replace(BLOCK, () => block(harness, preferences, rendered));
    if (text === before) continue;
    writeFileSync(file, text);
    synced.push(file);
  }
  return synced;
}
