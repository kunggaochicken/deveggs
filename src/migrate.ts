import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { BasketError } from "./basket.ts";
import { commitBasket, ensureBasket, run } from "./store.ts";

/** Where baskets lived before ~/.deveggs: inside the deveggs checkout. */
export const legacyBasket = (repoRoot: string): string => join(repoRoot, "my-basket");

/** Folders whose files are the basket's real content (not scaffolding or generated). */
const CONTENT_DIRS = ["eggs", "chickens", "cracked", "skills", "scripts"];

function hasFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? hasFiles(join(dir, entry.name)) : entry.name !== ".gitkeep"
  );
}

/** True if the basket holds any egg, chicken, cracked item, skill or script. */
export function hasContent(root: string): boolean {
  return CONTENT_DIRS.some((d) => hasFiles(join(root, d)));
}

/** Files allowed in a target basket we may replace: only what `ensureBasket` makes. */
const SCAFFOLD_ONLY = new Set([".git", "README.md", "PREFERENCES.md", ...CONTENT_DIRS]);

export interface Relink {
  link: string;
  from: string;
  to: string;
}

export interface MigrateResult {
  moved: boolean;
  messages: string[];
  relinks: Relink[];
  /** Global instruction files that still mention the old basket path. */
  staleMentions: string[];
}

const HARNESS_SKILLS = [".claude", ".codex", ".cursor", ".gemini"].map((h) => join(h, "skills"));
const HARNESS_INSTRUCTIONS = [join(".claude", "CLAUDE.md"), join(".codex", "AGENTS.md"), join(".gemini", "GEMINI.md")];

/** Ways the old basket path may be spelled: as given, and with symlinks resolved. */
function spellings(path: string): string[] {
  const out = [resolve(path)];
  try {
    const real = realpathSync(path);
    if (!out.includes(real)) out.push(real);
  } catch {
    // gone already (migrated); the plain spelling still matches links
  }
  return out;
}

/** Harness skill links that point into the old basket, and where they should point now. */
export function staleLinks(legacy: string, target: string, home: string = homedir()): Relink[] {
  const prefixes = spellings(legacy);
  const out: Relink[] = [];
  for (const rel of HARNESS_SKILLS) {
    const dir = join(home, rel);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const link = join(dir, name);
      if (!lstatSync(link).isSymbolicLink()) continue;
      const from = resolve(dirname(link), readlinkSync(link));
      for (const prefix of prefixes) {
        if (from === prefix || from.startsWith(prefix + sep)) {
          out.push({ link, from, to: target + from.slice(prefix.length) });
          break;
        }
      }
    }
  }
  return out;
}

export function relink(links: Relink[]): void {
  for (const { link, to } of links) {
    rmSync(link);
    symlinkSync(to, link);
  }
}

const quote = (s: string): string => (/^[\w./~@%+=:,-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
export const lnCommand = (r: Relink): string => `ln -sfn ${quote(r.to)} ${quote(r.link)}`;

function moveDir(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Make room for the old basket at `target`. A target holding only what `ensureBasket`
 * scaffolds (no remote) is removed; anything else is set aside, never deleted.
 */
function clearTarget(target: string, messages: string[]): void {
  if (!existsSync(target)) return;
  const extra = readdirSync(target).filter((f) => !SCAFFOLD_ONLY.has(f));
  const remote = existsSync(join(target, ".git")) && run("git", ["remote"], target).stdout.trim() !== "";
  if (!extra.length && !remote) {
    rmSync(target, { recursive: true, force: true });
    return;
  }
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const aside = `${target}.before-migrate-${stamp}`;
  renameSync(target, aside);
  messages.push(`set the empty basket that was at ${target} aside: ${aside} (delete it when you're happy)`);
}

/**
 * Move a legacy `<repo>/my-basket/` (with its own .git, if it has one) to the new
 * basket location. Refuses if both hold content.
 */
export function migrate(legacy: string, target: string, templates: string, home: string = homedir()): MigrateResult {
  const messages: string[] = [];
  let moved = false;
  if (!hasContent(legacy)) {
    messages.push(`nothing to migrate: ${legacy} has no eggs, chickens, skills or scripts`);
  } else if (hasContent(target)) {
    throw new BasketError(
      `both ${legacy} and ${target} hold a basket; refusing to merge them. ` +
        `Move what you want to keep into one of them by hand, then delete the other.`,
    );
  } else {
    const hadGit = existsSync(join(legacy, ".git"));
    // Before the move, while the old path still resolves.
    const links = staleLinks(legacy, target, home);
    const stale = mentions(legacy, home);
    clearTarget(target, messages);
    moveDir(legacy, target);
    moved = true;
    const message = "basket: migrate from my-basket/";
    const ensured = ensureBasket(target, templates, message);
    messages.push(...ensured.warnings.map((w) => `warning: ${w}`));
    const warning = commitBasket(target, message);
    if (warning) messages.push(`warning: ${warning}`);
    messages.push(`moved ${legacy} -> ${target}${hadGit ? " (with its git history)" : " (new git repo)"}`);
    return { moved, messages, relinks: links, staleMentions: stale };
  }
  return { moved, messages, relinks: staleLinks(legacy, target, home), staleMentions: mentions(legacy, home) };
}

function mentions(legacy: string, home: string): string[] {
  return HARNESS_INSTRUCTIONS.map((f) => join(home, f)).filter((f) => {
    try {
      return spellings(legacy).some((p) => readFileSync(f, "utf8").includes(p));
    } catch {
      return false;
    }
  });
}
