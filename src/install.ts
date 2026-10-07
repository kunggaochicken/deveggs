import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Harness {
  name: string;
  /** Directory whose presence means the harness is installed. */
  home: string;
  skillsDir: string;
  instructionsFile: string;
}

export function harnesses(home: string): Harness[] {
  return [
    {
      name: "claude",
      home: join(home, ".claude"),
      skillsDir: join(home, ".claude", "skills"),
      instructionsFile: join(home, ".claude", "CLAUDE.md"),
    },
    {
      name: "codex",
      home: join(home, ".codex"),
      skillsDir: join(home, ".codex", "skills"),
      instructionsFile: join(home, ".codex", "AGENTS.md"),
    },
  ];
}

export type Action =
  | { type: "link"; harness: string; path: string; target: string }
  | { type: "unlink"; harness: string; path: string }
  | { type: "block"; harness: string; path: string; content: string }
  | { type: "skip"; harness: string; path: string; reason: string };

const BEGIN = "<!-- deveggs:begin -->";
const END = "<!-- deveggs:end -->";
const BLOCK_RE = new RegExp(`\\n*${BEGIN}[\\s\\S]*?${END}\\n?`);

export function managedBlock(repoRoot: string): string {
  const prefs = join(repoRoot, "my-basket", "PREFERENCES.md");
  return [
    BEGIN,
    "## deveggs",
    "",
    `My agentic-dev preferences live in a harness-agnostic basket at \`${repoRoot}\`.`,
    `- Read \`${prefs}\` at session start and follow it; it outranks harness-local memory.`,
    "- Use the `deveggs` skill to lay or warm eggs when I state or reveal how I like to work.",
    END,
  ].join("\n");
}

/** Insert or replace the managed block, leaving the rest of the file untouched. */
export function upsertBlock(existing: string, block: string): string {
  if (BLOCK_RE.test(existing)) return existing.replace(BLOCK_RE, `\n\n${block}\n`).replace(/^\n+/, "");
  const sep = existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${sep}${block}\n`;
}

export function removeBlock(existing: string): string {
  return existing.replace(BLOCK_RE, "\n").replace(/\n+$/, "\n");
}

function linkTarget(path: string): string | undefined {
  try {
    return lstatSync(path).isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : undefined;
  } catch {
    return undefined;
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Skills to expose: the meta-skill, every chicken skill, and every egg skill on trial.
 * Chickens outrank eggs, so an egg skill is skipped if a chicken already has its name.
 */
export function skillSources(repoRoot: string): Array<{ name: string; dir: string }> {
  const out = [{ name: "deveggs", dir: join(repoRoot, "skills", "deveggs") }];
  for (const tier of ["chickens", "eggs"]) {
    const base = join(repoRoot, "my-basket", "skills", tier);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      if (out.some((s) => s.name === name)) continue;
      if (existsSync(join(base, name, "SKILL.md"))) out.push({ name, dir: join(base, name) });
    }
  }
  return out;
}

export function planInstall(repoRoot: string, targets: Harness[]): Action[] {
  const actions: Action[] = [];
  const sources = skillSources(repoRoot);
  for (const h of targets) {
    for (const skill of sources) {
      const path = join(h.skillsDir, skill.name);
      const current = linkTarget(path);
      if (current === skill.dir) continue;
      // A link into this repo that's now dangling (e.g. the skill hatched and moved) is ours to repoint.
      if (exists(path) && (current === undefined || !current.startsWith(repoRoot))) {
        actions.push({ type: "skip", harness: h.name, path, reason: "exists and is not managed by deveggs" });
        continue;
      }
      actions.push({ type: "link", harness: h.name, path, target: skill.dir });
    }
    // Drop our links to skills that were cracked or removed.
    if (existsSync(h.skillsDir)) {
      for (const name of readdirSync(h.skillsDir)) {
        const path = join(h.skillsDir, name);
        const current = linkTarget(path);
        if (current?.startsWith(repoRoot) && !sources.some((s) => s.name === name)) {
          actions.push({ type: "unlink", harness: h.name, path });
        }
      }
    }
    const existing = existsSync(h.instructionsFile) ? readFileSync(h.instructionsFile, "utf8") : "";
    const next = upsertBlock(existing, managedBlock(repoRoot));
    if (next !== existing) actions.push({ type: "block", harness: h.name, path: h.instructionsFile, content: next });
  }
  return actions;
}

export function planUninstall(repoRoot: string, targets: Harness[]): Action[] {
  const actions: Action[] = [];
  for (const h of targets) {
    if (existsSync(h.skillsDir)) {
      for (const name of readdirSync(h.skillsDir)) {
        const path = join(h.skillsDir, name);
        if (linkTarget(path)?.startsWith(repoRoot)) actions.push({ type: "unlink", harness: h.name, path });
      }
    }
    if (existsSync(h.instructionsFile)) {
      const existing = readFileSync(h.instructionsFile, "utf8");
      const next = removeBlock(existing);
      if (next !== existing) actions.push({ type: "block", harness: h.name, path: h.instructionsFile, content: next });
    }
  }
  return actions;
}

export function apply(actions: Action[]): void {
  for (const a of actions) {
    switch (a.type) {
      case "link":
        mkdirSync(dirname(a.path), { recursive: true });
        if (exists(a.path)) rmSync(a.path);
        symlinkSync(a.target, a.path);
        break;
      case "unlink":
        rmSync(a.path);
        break;
      case "block":
        mkdirSync(dirname(a.path), { recursive: true });
        writeFileSync(a.path, a.content);
        break;
      case "skip":
        break;
    }
  }
}

export function describe(a: Action): string {
  switch (a.type) {
    case "link":
      return `[${a.harness}] link   ${a.path} -> ${a.target}`;
    case "unlink":
      return `[${a.harness}] unlink ${a.path}`;
    case "block":
      return `[${a.harness}] update ${a.path} (managed deveggs block)`;
    case "skip":
      return `[${a.harness}] skip   ${a.path}: ${a.reason}`;
  }
}
