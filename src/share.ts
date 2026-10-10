import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { Basket, BasketError, type Egg, serializeEgg, type Tier } from "./basket.ts";
import { architectureOf, ARCH_HEADING, isScaffold, withoutArchitecture } from "./architecture.ts";
import {
  cleanFields,
  formatHistory,
  hasLegacySections,
  type HistoryEntry,
  historyFileName,
  isDate,
  legacyHistory,
  type LoggedMove,
  stripLegacySections,
} from "./history.ts";
import { run } from "./store.ts";
import { type Cell, type Column, palette, table } from "./table.ts";
import { mark, type ViewOptions } from "./view.ts";

/**
 * `deveggs share`: build a sanitized copy of the personal basket, preview what is
 * shared and what was redacted, then open a PR that adds it to the baskets repo
 * (kunggaochicken/deveggs-baskets, baskets/<user>/, unless --repo/--dir say otherwise).
 *
 * Sanitizing (planShare and everything above publishShare) only reads the basket and
 * never depends on where the copy goes. publishShare is the only part that touches
 * git, the network or gh.
 */

/** Where shared baskets go unless --repo says otherwise. */
export const DEFAULT_SHARE_REPO = "kunggaochicken/deveggs-baskets";

/** The folder a developer's basket goes in, inside that repo. */
export const shareDir = (user: string): string => `baskets/${user}`;

/** One private term per line in the basket; `#` starts a comment. Redacted wherever they appear. */
export const PRIVATE_TERMS_FILE = "private-terms.txt";

/** Items tagged with this never leave the basket: `deveggs share` leaves them out whole. */
export const PRIVATE_TAG = "private";

/** Repo names that are public by definition, so never auto-added as private terms. */
const PUBLIC_TERMS = new Set(["deveggs"]);

export interface ShareOptions {
  /** Keep each egg's Origin quote (after redaction). Off by default: quotes are verbatim session text. */
  keepQuotes?: boolean;
  /** Include scripts/ (after redaction). Off by default: scripts hardcode machine details. */
  includeScripts?: boolean;
  /** Redacted wherever they appear, case-insensitively, as whole words. */
  privateTerms?: string[];
  /** Item ids to leave out entirely. */
  skip?: string[];
  /** The developer's home directory, redacted to `~`. */
  home?: string;
  /** Hatches and cracks from the basket's git log, for items whose history isn't migrated yet. */
  moves?: LoggedMove[];
}

export interface ShareFile {
  /** Relative to the shared basket's folder. */
  path: string;
  content: string;
  executable?: boolean;
}

export interface ShareItem {
  /** Relative to the basket, e.g. eggs/foo.md or skills/chickens/bar/SKILL.md. */
  path: string;
  /** 🐔 🥚 🐣 💥 for eggs; empty for skills and scripts. */
  mark: string;
  shared: boolean;
  /** For excluded items, why. */
  why?: string;
  /** What was removed or redacted, e.g. "quote", "context", "email×2". */
  redactions: string[];
  /** The fact as it will be published (eggs only). */
  fact?: string;
}

export interface SharePlan {
  files: ShareFile[];
  items: ShareItem[];
  /** The private terms that were applied (from the options plus the auto-detected ones). */
  terms: string[];
}

// --- redaction -----------------------------------------------------------------

type Hits = Map<string, number>;

interface Rule {
  label: string;
  pattern: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
}

/** Applied in order: specific secrets before generic ones, URLs before paths. */
const RULES: Rule[] = [
  { label: "secret", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: "<secret>" },
  {
    label: "token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|xox[abposr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,})/g,
    replace: "<token>",
  },
  { label: "token", pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, replace: "<token>" },
  {
    label: "secret",
    pattern: /\b((?:api[_-]?key|access[_-]?key|secret|token|password|passwd|pwd|auth)["']?\s*[:=]\s*["']?)([^\s"'<>]{6,})/gi,
    replace: (_m, key: string) => `${key}<secret>`,
  },
  { label: "repo-url", pattern: /\b[\w.-]+@[\w.-]+:[\w./~-]+?\.git\b/g, replace: "<repo-url>" },
  // Trailing sentence punctuation stays outside the URL.
  { label: "url", pattern: /\b(?:https?|ssh|git):\/\/[^\s)>\]"'`]*[^\s)>\]"'`.,;:!?]/g, replace: "<url>" },
  { label: "email", pattern: /[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, replace: "<email>" },
  { label: "session", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replace: "<session>" },
  { label: "path", pattern: /(?:\/Users|\/home)\/[^/\s"'`<>]+/g, replace: "~" },
  { label: "path", pattern: /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s"'`<>]+/g, replace: "~" },
  { label: "token", pattern: /\b[0-9a-f]{32,}\b/gi, replace: "<token>" },
  {
    label: "token",
    pattern: /[A-Za-z0-9+_=-]{40,}/g,
    replace: (m: string) => (/[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m) ? "<token>" : m),
  },
];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function termPattern(term: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escape(term)}(?![A-Za-z0-9])`, "gi");
}

/** Normalize a private-terms list: trimmed, non-empty, longest first, case-insensitively unique. */
export function cleanTerms(terms: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const raw of terms) {
    const term = raw.trim();
    if (term && !seen.has(term.toLowerCase())) seen.set(term.toLowerCase(), term);
  }
  return [...seen.values()].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Redact secrets, emails, URLs, session ids, home paths and private terms from text. */
export function redact(text: string, terms: string[] = [], home?: string, hits: Hits = new Map()): string {
  const count = (label: string): void => {
    hits.set(label, (hits.get(label) ?? 0) + 1);
  };
  let out = text;
  if (home && home.length > 1 && home !== "/") {
    out = out.split(home).join("\u0000HOME\u0000");
    const n = text.split(home).length - 1;
    for (let i = 0; i < n; i++) count("path");
  }
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.filter((g): g is string => typeof g === "string");
      const replaced = typeof rule.replace === "string" ? rule.replace : rule.replace(match, ...groups);
      if (replaced !== match) count(rule.label);
      return replaced;
    });
  }
  out = out.replace(/\u0000HOME\u0000/g, "~");
  for (const term of terms) {
    out = out.replace(termPattern(term), () => {
      count("private");
      return "<private>";
    });
  }
  return out;
}

const labels = (hits: Hits): string[] => [...hits].map(([label, n]) => (n > 1 ? `${label}×${n}` : label));

// --- eggs ----------------------------------------------------------------------

/** An item's history from its legacy body sections, when it has no history of its own. */
const historyOf = (egg: Egg, history?: HistoryEntry[]): HistoryEntry[] => history ?? (hasLegacySections(egg.body) ? legacyHistory(egg) : []);

/**
 * The repo names in an item's history (`repo:` on its lay, trials, evolves…). An
 * `imported` entry names a public baskets repo, not a private one, so it's skipped.
 */
export function originRepos(egg: Egg, history?: HistoryEntry[]): string[] {
  return historyOf(egg, history)
    .filter((e) => e.event !== "imported")
    .map((e) => e.fields["repo"]?.trim() ?? "")
    .filter((repo) => repo && !egg.harnesses.includes(repo));
}

/**
 * Private terms worth redacting without being told: the repo names eggs were laid in
 * (minus public ones like deveggs) and the developer's home folder name.
 */
export function autoTerms(eggs: Egg[], home?: string, publicNames: string[] = [], histories: Map<string, HistoryEntry[]> = new Map()): string[] {
  const keep = new Set([...PUBLIC_TERMS, ...publicNames.map((n) => n.toLowerCase())]);
  const terms = eggs.flatMap((egg) => originRepos(egg, histories.get(egg.id)));
  if (home) terms.push(basename(home));
  return cleanTerms(terms.filter((t) => t.length >= 3 && !keep.has(t.toLowerCase())));
}

export interface SanitizedEgg {
  egg: Egg;
  /** What may be published of its history: lay, evolves, hatch, renames and imports, stripped down. */
  history: HistoryEntry[];
  redactions: string[];
}

/** Fields that say where and how something happened in the developer's own loop: never shared. */
const CONTEXT_FIELDS = ["harness", "repo", "session"];

/**
 * Strip an item down to what is safe to publish: id, kind, tags, trial counts, dates and
 * the fact, its architecture diagram (unless still a scaffold; references in it to items
 * left out of the share, `hidden`, become `<private>`), plus a history of its lay, evolves (each version's was/now wording), hatch,
 * renames and imports. Quotes (unless keepQuotes), context (harness, repo, session),
 * harnesses, notes (and every why, scenario, cause and tuning), trials and cracks are
 * removed; everything kept is redacted. `history` is the item's history; without it,
 * it's read from legacy body sections.
 */
export function sanitizeEgg(egg: Egg, raw: string, options: ShareOptions = {}, terms: string[] = [], history?: HistoryEntry[], hidden: string[] = []): SanitizedEgg {
  const hits: Hits = new Map();
  const removed: string[] = [];
  const entries = historyOf(egg, history);
  const add = (label: string): void => {
    if (!removed.includes(label)) removed.push(label);
  };
  const quoted = (e: HistoryEntry): boolean => Boolean(e.quote) && e.event !== "trial";
  if (entries.some((e) => e.event !== "evolved" && quoted(e)) && !options.keepQuotes) add("quote");
  if (entries.some((e) => CONTEXT_FIELDS.some((k) => e.fields[k])) || /^context:/m.test(raw.split(/\n---\n/)[0] ?? "")) add("context");
  if (egg.harnesses.length) add("harness");
  if (entries.some((e) => e.event === "trial")) add("trial notes");
  if (entries.some((e) => e.event === "evolved" && e.quote) && !options.keepQuotes) add("evolution quote");
  const noted = (e: HistoryEntry): boolean => e.event !== "trial" && Object.keys(e.fields).some((k) => ["why", "note", "scenario", "result", "cause", "tuning"].includes(k));
  if (withoutArchitecture(stripLegacySections(egg.body)) || entries.some((e) => noted(e) || e.text)) add("notes");
  const clean = (text: string): string => redact(text, terms, options.home, hits);
  const summary = clean(egg.summary);
  const tags = egg.tags.map((t) => redact(t, terms, options.home, hits)).filter((t) => !t.includes("<"));
  const keepQuote = (e: HistoryEntry): { quote?: string } => (options.keepQuotes && e.quote && e.event !== "trial" ? { quote: clean(e.quote) } : {});
  const shared = entries.flatMap((e): HistoryEntry[] => {
    const base = { date: isDate(e.date) ? e.date : egg.laid, event: e.event, version: e.version };
    switch (e.event) {
      case "laid":
        return [{
          ...base,
          ...keepQuote(e),
          // The fact as laid is often the fact today: reuse its redaction rather than count it twice.
          fields: cleanFields({ fact: e.fields["fact"] && (e.fields["fact"] === egg.summary ? summary : clean(e.fields["fact"])), tier: e.fields["tier"] && clean(e.fields["tier"]) }),
        }];
      case "evolved":
        return [{ ...base, ...keepQuote(e), fields: cleanFields({ was: clean(e.fields["was"] ?? ""), now: clean(e.fields["now"] ?? "") }) }];
      case "hatched":
        return [{ ...base, ...keepQuote(e), fields: cleanFields({ trials: e.fields["trials"] && clean(e.fields["trials"]) }) }];
      case "renamed":
        return [{ ...base, fields: cleanFields({ from: clean(e.fields["from"] ?? ""), to: clean(e.fields["to"] ?? "") }) }];
      case "imported":
        return [{ ...base, ...keepQuote(e), fields: cleanFields({ from: clean(e.fields["from"] ?? ""), basket: clean(e.fields["basket"] ?? "") }) }];
      default:
        return []; // trials (the developer's own loop) and cracks
    }
  });
  const arch = architectureOf(egg.body);
  if (isScaffold(arch)) add("unfinished diagram");
  const architecture = arch && !isScaffold(arch) ? hideIds(clean(arch), hidden, hits) : "";
  return {
    egg: { ...egg, summary, tags, harnesses: [], body: architecture ? `## ${ARCH_HEADING}\n\n${architecture}` : "" },
    history: shared,
    redactions: [...removed, ...labels(hits)],
  };
}

/**
 * Replace references to left-out items (`id`, [[id]], file paths naming them, and the id
 * written with other case, `_` or spaces) with <private>. Runs after redaction, so swapping
 * an id inside a URL or an email can't stop those from being redacted whole.
 */
function hideIds(text: string, ids: string[], hits: Hits): string {
  let out = text;
  for (const id of [...ids].sort((a, b) => b.length - a.length)) {
    const loose = id.split("-").map(escape).join("[-_ ]");
    out = out.replace(new RegExp(`(?<![\\w-])${loose}(?![\\w-])`, "gi"), () => {
      hits.set("private item", (hits.get("private item") ?? 0) + 1);
      return "<private>";
    });
  }
  return out;
}

// --- the plan ------------------------------------------------------------------

const TIER_DIRS: Array<[Tier, string]> = [["chicken", "chickens"], ["egg", "eggs"], ["cracked", "cracked"]];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.isFile() && entry.name !== ".gitkeep" && entry.name !== ".DS_Store" ? [path] : [];
    });
}

/** Read the private-terms file in the basket, if there is one. */
export function readPrivateTerms(root: string): string[] {
  const file = join(root, PRIVATE_TERMS_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
}

/**
 * Work out exactly what `deveggs share` would publish from the basket at `root`, and
 * what it redacted or left out. Reads the basket; writes nothing.
 *
 * Shared: chickens and eggs (sanitized, with their architecture diagrams), their histories (sanitized: see sanitizeEgg) and
 * their skills (redacted).
 * Left out: cracked items and their skills, items tagged `private` and their skills,
 * skipped ids, ids that contain a private term, scripts/ (unless includeScripts), binary files, and everything else in the
 * basket (README.md, PREFERENCES.md, logs/, private-terms.txt, dotfiles).
 */
export function planShare(root: string, options: ShareOptions = {}, publicNames: string[] = []): SharePlan {
  const basket = new Basket(root);
  const eggs = basket.all();
  const raws = new Map<string, string>();
  for (const [tier, dir] of TIER_DIRS) {
    for (const egg of eggs.filter((e) => e.tier === tier)) raws.set(egg.id, readFileSync(join(root, dir, `${egg.id}.md`), "utf8"));
  }
  const histories = new Map(eggs.map((e) => [e.id, basket.history(e.id, options.moves)]));
  const terms = cleanTerms([...(options.privateTerms ?? []), ...readPrivateTerms(root), ...autoTerms(eggs, options.home, publicNames, histories)]);
  const skip = new Set(options.skip ?? []);
  const files: ShareFile[] = [];
  const items: ShareItem[] = [];
  const idLeaks = (id: string): boolean => terms.some((t) => termPattern(t).test(id));
  const tagged = new Set(eggs.filter((e) => e.tags.includes(PRIVATE_TAG)).map((e) => e.id));
  const excluded = (id: string, tier: Tier): string | undefined =>
    tier === "cracked"
      ? "cracked"
      : tagged.has(id)
        ? `tagged ${PRIVATE_TAG}`
        : skip.has(id)
          ? "skipped (--skip)"
          : idLeaks(id)
            ? "id has a private term; rename it or --skip it"
            : undefined;

  const hidden = eggs.filter((e) => excluded(e.id, "egg")).map((e) => e.id); // cracked ids aren't secret
  for (const [tier, dir] of TIER_DIRS) {
    for (const egg of eggs.filter((e) => e.tier === tier)) {
      const path = `${dir}/${egg.id}.md`;
      const why = excluded(egg.id, tier);
      if (why) {
        items.push({ path, mark: mark(egg), shared: false, why, redactions: [] });
        continue;
      }
      const clean = sanitizeEgg(egg, raws.get(egg.id) ?? "", options, terms, histories.get(egg.id), hidden);
      files.push({ path, content: serializeEgg(clean.egg) });
      if (clean.history.length) files.push({ path: `${dir}/${historyFileName(egg.id)}`, content: formatHistory(egg.id, clean.history) });
      items.push({ path, mark: mark(egg), shared: true, redactions: clean.redactions, fact: clean.egg.summary });
    }
  }

  const tierOf = new Map(eggs.map((e) => [e.id, e.tier]));
  const addText = (abs: string, path: string, why: string | undefined): void => {
    if (why) {
      items.push({ path, mark: "", shared: false, why, redactions: [] });
      return;
    }
    const buffer = readFileSync(abs);
    if (buffer.includes(0)) {
      items.push({ path, mark: "", shared: false, why: "binary file", redactions: [] });
      return;
    }
    const hits: Hits = new Map();
    const content = redact(buffer.toString("utf8"), terms, options.home, hits);
    const executable = (statSync(abs).mode & 0o111) !== 0;
    files.push({ path, content, ...(executable && { executable }) });
    items.push({ path, mark: "", shared: true, redactions: labels(hits) });
  };

  for (const [tier, dir] of TIER_DIRS) {
    const skills = join(root, "skills", dir);
    if (!existsSync(skills)) continue;
    for (const id of readdirSync(skills).sort()) {
      const folder = join(skills, id);
      if (!statSync(folder).isDirectory()) continue;
      const why = excluded(id, tierOf.get(id) === "cracked" ? "cracked" : tier);
      for (const abs of walk(folder)) addText(abs, relative(root, abs).split("\\").join("/"), why);
    }
  }

  for (const abs of walk(join(root, "scripts"))) {
    const path = relative(root, abs).split("\\").join("/");
    addText(abs, path, options.includeScripts ? undefined : "scripts (pass --include-scripts)");
  }

  return { files, items, terms };
}

/** Write the plan into `dir`, replacing whatever was there. */
export function writeShare(plan: SharePlan, dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const file of plan.files) {
    const path = join(dir, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
    if (file.executable) chmodSync(path, 0o755);
  }
}

// --- preview -------------------------------------------------------------------

/** The review table printed before anything leaves the machine. */
export function formatPreview(plan: SharePlan, destination: string, options: ViewOptions): string {
  const p = palette(options.color);
  const columns: Column[] = [{ header: "" }, { header: "item" }, { header: "removed / redacted", max: 48 }, { header: "shared as", flex: true, min: 20 }];
  const rows = plan.items.map((item): Cell[] => [
    { text: item.mark },
    { text: item.path, ...(!item.shared && { paint: p.dim }) },
    item.shared ? { text: item.redactions.join(", ") || "nothing" } : { text: `left out: ${item.why ?? ""}`, paint: p.dim },
    { text: item.shared ? (item.fact ?? "(redacted copy)") : "" },
  ]);
  const shared = plan.items.filter((i) => i.shared).length;
  return [
    `deveggs share: preview of ${destination} (nothing has left your machine)`,
    "",
    ...table(columns, rows, { width: options.width, palette: p }),
    "",
    `${shared} shared · ${plan.items.length - shared} left out`,
    `private terms redacted: ${plan.terms.length ? plan.terms.join(", ") : "none"} (add more in ${PRIVATE_TERMS_FILE} in your basket, or --private)`,
    "Not detected automatically: names of people, clients or internal hosts. Add them as private terms or --skip the item.",
  ].join("\n");
}

// --- publishing ----------------------------------------------------------------

export interface PublishOptions {
  /** owner/name of the baskets repo. */
  repo: string;
  /** Folder in that repo, e.g. baskets/<user>. */
  dir: string;
  /** GitHub username the basket is shared as. */
  user: string;
  /** Asked after the commit is made and before anything is pushed. Return false to stop. */
  confirm: (review: string) => boolean;
  /** Where repos are cloned from: `<gitBase><owner>/<name>.git`. Default https://github.com/ (tests use a local folder). */
  gitBase?: string;
  log?: (line: string) => void;
}

export interface Published {
  pushed: boolean;
  url?: string;
  message: string;
}

const firstLine = (text: string): string => text.trim().split("\n").find(Boolean)?.trim() ?? "";

function must(r: ReturnType<typeof run>, what: string): string {
  if (r.missing) throw new BasketError(`${what} failed: command not found`);
  if (r.status !== 0) throw new BasketError(`${what} failed: ${firstLine(r.stderr) || firstLine(r.stdout) || "unknown error"}`);
  return r.stdout;
}

/**
 * Clone the baskets repo into a temp folder, write the sanitized copy into
 * `dir`, commit only that folder on a branch, then (once confirmed) push it and open
 * a PR with gh. If the developer can't push to the repo, the branch goes to their fork.
 * The personal basket is never in that clone, so it can't be committed.
 */
export function publishShare(plan: SharePlan, options: PublishOptions): Published {
  const log = options.log ?? ((): void => {});
  const gitBase = options.gitBase ?? "https://github.com/";
  const [, name = ""] = options.repo.split("/");
  const branch = `share/${options.user}`;
  const work = mkdtempSync(join(tmpdir(), "deveggs-share-"));
  try {
    const clone = join(work, name || "repo");
    log(`cloning ${options.repo}…`);
    must(run("git", ["clone", "-q", "--depth", "1", `${gitBase}${options.repo}.git`, clone]), `git clone ${options.repo}`);
    must(run("git", ["switch", "-q", "-c", branch], clone), "git switch");
    writeShare(plan, join(clone, options.dir));
    must(run("git", ["add", "-A", "--", options.dir], clone), "git add");
    const staged = must(run("git", ["diff", "--cached", "--name-only"], clone), "git diff").split("\n").filter(Boolean);
    const stray = staged.filter((f) => !f.startsWith(`${options.dir}/`));
    if (stray.length) throw new BasketError(`refusing to commit files outside ${options.dir}/: ${stray.join(", ")}`);
    if (!staged.length) return { pushed: false, message: `${options.repo} already has this basket in ${options.dir}/; nothing to share` };
    must(run("git", ["commit", "-q", "-m", `baskets: ${options.user}'s basket`], clone), "git commit");
    const stat = must(run("git", ["show", "--stat", "--format=", "HEAD"], clone), "git show");
    if (!options.confirm(`${staged.length} files in ${options.dir}/ of ${options.repo}:\n${stat.trimEnd()}\nreview them: git -C ${clone} show`)) {
      return { pushed: false, message: "nothing pushed" };
    }
    const canPush = run("gh", ["api", `repos/${options.repo}`, "--jq", ".permissions.push"]).stdout.trim() === "true";
    let head = branch;
    let pushTo = "origin";
    if (!canPush) {
      log(`you can't push to ${options.repo}; using your fork ${options.user}/${name}`);
      must(run("gh", ["repo", "fork", options.repo, "--clone=false"]), "gh repo fork");
      pushTo = `${gitBase}${options.user}/${name}.git`;
      head = `${options.user}:${branch}`;
    }
    // share/<user> only ever holds this generated folder, so replacing it is safe.
    must(run("git", ["push", "-q", "--force", pushTo, `HEAD:refs/heads/${branch}`], clone), "git push");
    const body = [
      `Adds ${options.user}'s basket to \`${options.dir}/\`, made with \`deveggs share\`.`,
      "",
      "Sanitized before pushing: origin and evolution quotes, context (harness, repo, session), harnesses, notes and trials removed from items and their histories;",
      "emails, tokens, URLs, session ids, home paths and private terms redacted; cracked items, items tagged private and scripts left out.",
      "",
      ...plan.items.filter((i) => i.shared).map((i) => `- \`${i.path}\``),
    ].join("\n");
    const pr = run("gh", ["pr", "create", "--repo", options.repo, "--base", "main", "--head", head, "--title", `Share ${options.user}'s basket`, "--body", body]);
    if (pr.status !== 0 && /already exists/i.test(pr.stderr)) {
      return { pushed: true, message: `updated your open share PR (${firstLine(pr.stderr)})` };
    }
    const url = firstLine(must(pr, "gh pr create"));
    return { pushed: true, url, message: `opened ${url}` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
