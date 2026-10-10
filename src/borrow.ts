import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BasketError, type Egg, parseEgg, slugify, type Tier } from "./basket.ts";
import { type HistoryEntry, historyFileName, isHistoryFile, parseHistory } from "./history.ts";
import { run } from "./store.ts";
import { type Cell, type Column, palette, table } from "./table.ts";
import type { ViewOptions } from "./view.ts";

/**
 * `deveggs browse` and `deveggs import`: read the shared baskets repo
 * (kunggaochicken/deveggs-baskets, `baskets/<github-username>/`) and borrow items
 * from it. Everything here reads a local checkout of that repo; `cloneBaskets` is the
 * only part that touches the network, and the CLI passes it in, so tests use a local repo.
 */

/** Shared baskets live in `baskets/<github-username>/` of the baskets repo. */
export const BASKETS_DIR = "baskets";

const GITHUB_USER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export const isGitHubUser = (name: string): boolean => GITHUB_USER.test(name);

/** Only these tiers are borrowable; a shared cracked/ (if anyone published one) is ignored. */
const SHARED_TIERS: Array<[Tier, string]> = [["chicken", "chickens"], ["egg", "eggs"]];

export interface SharedItem {
  user: string;
  egg: Egg;
  /** The item's skill folder in the checkout, if it has one. */
  skill?: string;
  /** Its shared history (`<id>.history.md`), if it has one. */
  history?: HistoryEntry[];
}

export interface SharedBasket {
  user: string;
  /** First line of prose in the basket's README.md, if any. */
  about: string;
  items: SharedItem[];
}

/** A checkout of the baskets repo, removed by `cleanup`. */
export interface Checkout {
  dir: string;
  cleanup: () => void;
}

/** Fetches a checkout of a baskets repo (owner/name). Injected so tests never hit the network. */
export type FetchBaskets = (repo: string) => Checkout;

const firstLine = (text: string): string => text.trim().split("\n").find(Boolean)?.trim() ?? "";

/**
 * Shallow-clone the baskets repo into a temp folder, read-only. `gitBase` is where repos
 * are cloned from (`<gitBase><owner>/<name>.git`), https://github.com/ by default.
 */
export function cloneBaskets(repo: string, gitBase = "https://github.com/"): Checkout {
  const work = mkdtempSync(join(tmpdir(), "deveggs-baskets-"));
  const cleanup = (): void => rmSync(work, { recursive: true, force: true });
  const dir = join(work, "repo");
  const clone = run("git", ["clone", "-q", "--depth", "1", `${gitBase}${repo}.git`, dir], undefined, {
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  if (clone.status !== 0) {
    cleanup();
    const why = clone.missing ? "git not found" : firstLine(clone.stderr) || "git clone failed";
    throw new BasketError(`couldn't fetch ${repo}: ${why}`);
  }
  return { dir, cleanup };
}

/** Run `use` on a fresh checkout of `repo`, then remove it. */
export function withBaskets<T>(fetch: FetchBaskets, repo: string, use: (dir: string) => T): T {
  const checkout = fetch(repo);
  try {
    return use(checkout.dir);
  } finally {
    checkout.cleanup();
  }
}

/** Usernames with a shared basket in the checkout, sorted. */
export function sharedUsers(dir: string): string[] {
  const root = join(dir, BASKETS_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => isGitHubUser(name) && statSync(join(root, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b));
}

function about(folder: string): string {
  const readme = join(folder, "README.md");
  if (!existsSync(readme)) return "";
  return readFileSync(readme, "utf8").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";
}

/** One user's shared basket: chickens, then eggs. Files that aren't valid items are skipped. */
export function sharedBasket(dir: string, user: string): SharedBasket {
  if (!isGitHubUser(user)) throw new BasketError(`invalid username ${JSON.stringify(user)}`);
  const folder = join(dir, BASKETS_DIR, user);
  if (!existsSync(folder)) throw new BasketError(`no shared basket for ${user}; deveggs browse lists them`);
  const items: SharedItem[] = [];
  for (const [tier, sub] of SHARED_TIERS) {
    const tierDir = join(folder, sub);
    if (!existsSync(tierDir)) continue;
    for (const file of readdirSync(tierDir).filter((f) => f.endsWith(".md") && !isHistoryFile(f)).sort()) {
      let egg: Egg;
      try {
        egg = parseEgg(readFileSync(join(tierDir, file), "utf8"), tier);
      } catch {
        continue;
      }
      if (`${egg.id}.md` !== file || !validId(egg.id)) continue;
      const skill = join(folder, "skills", sub, egg.id);
      const history = join(tierDir, historyFileName(egg.id));
      items.push({
        user,
        egg,
        ...(existsSync(join(skill, "SKILL.md")) && { skill }),
        ...(existsSync(history) && { history: parseHistory(readFileSync(history, "utf8")) }),
      });
    }
  }
  return { user, about: about(folder), items };
}

function validId(id: string): boolean {
  try {
    return slugify(id) === id;
  } catch {
    return false;
  }
}

/** Every shared basket in the checkout. */
export function sharedBaskets(dir: string): SharedBasket[] {
  return sharedUsers(dir).map((user) => sharedBasket(dir, user));
}

/** Parse `<username>/<id>`. */
export function parseRef(ref: string | undefined): { user: string; id: string } {
  const [user = "", id = "", ...extra] = (ref ?? "").split("/");
  if (!user || !id || extra.length) throw new BasketError("usage: deveggs import <username>/<id> (deveggs browse lists them)");
  if (!isGitHubUser(user)) throw new BasketError(`invalid username ${JSON.stringify(user)}`);
  if (!validId(id)) throw new BasketError(`invalid id ${JSON.stringify(id)}`);
  return { user, id };
}

/** The item `<user>/<id>` in the checkout, or a helpful error. */
export function findShared(dir: string, user: string, id: string): SharedItem {
  const item = sharedBasket(dir, user).items.find((i) => i.egg.id === id);
  if (!item) throw new BasketError(`${user}'s basket has no egg or chicken named ${id}; deveggs browse ${user} lists them`);
  return item;
}

export interface Filter {
  tag?: string | undefined;
  kind?: string | undefined;
}

export const matches = (item: SharedItem, filter: Filter): boolean =>
  (!filter.tag || item.egg.tags.includes(filter.tag)) && (!filter.kind || item.egg.kind === filter.kind);

// --- output --------------------------------------------------------------------

/** The list of shared baskets: one row per user with what's in it. */
export function formatBaskets(baskets: SharedBasket[], repo: string, options: ViewOptions): string {
  if (!baskets.length) return `no shared baskets in ${repo} yet. Share yours: deveggs share --dry-run`;
  const p = palette(options.color);
  const count = (b: SharedBasket, tier: Tier): string => String(b.items.filter((i) => i.egg.tier === tier).length);
  const columns: Column[] = [{ header: "basket" }, { header: "🐔" }, { header: "🥚" }, { header: "skills" }, { header: "about", flex: true, min: 20 }];
  const rows = baskets.map((b): Cell[] => [
    { text: b.user, paint: p.bold },
    { text: count(b, "chicken") },
    { text: count(b, "egg") },
    { text: String(b.items.filter((i) => i.skill).length) },
    { text: b.about, paint: p.dim },
  ]);
  return [
    `shared baskets in ${repo}`,
    "",
    ...table(columns, rows, { width: options.width, palette: p }),
    "",
    "see one: deveggs browse <username>  ·  borrow an item as an egg: deveggs import <username>/<id>",
  ].join("\n");
}

/**
 * Shared items as a table (tier, id, kind, tags, fact). With `user`, one basket and
 * bare ids; without, items from every basket as `<username>/<id>`, ready for import.
 */
export function formatItems(items: SharedItem[], heading: string, options: ViewOptions, user?: string): string {
  const p = palette(options.color);
  if (!items.length) return `${heading}\n\nnothing matches`;
  const columns: Column[] = [{ header: "" }, { header: "id" }, { header: "kind" }, { header: "tags", max: 20 }, { header: "fact", flex: true, min: 20 }];
  const rows = items.map((item): Cell[] => [
    { text: item.egg.tier === "chicken" ? "🐔" : "🥚" },
    { text: user ? item.egg.id : `${item.user}/${item.egg.id}`, ...(item.egg.tier === "chicken" && { paint: p.bold }) },
    { text: item.egg.kind + (item.skill && item.egg.kind !== "skill" ? " +skill" : ""), paint: p.dim },
    { text: item.egg.tags.join(", "), paint: p.dim },
    { text: item.egg.summary },
  ]);
  return [
    heading,
    "",
    ...table(columns, rows, { width: options.width, palette: p }),
    "",
    `borrow one as an egg (trials start at ✓0 ✗0): deveggs import ${user ? `${user}/<id>` : "<username>/<id>"}`,
  ].join("\n");
}
