import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanFields,
  formatEntry,
  formatHistory,
  hasLegacySections,
  historyFileName,
  type HistoryEntry,
  historyHeader,
  isHistoryFile,
  legacyHistory,
  type LoggedMove,
  parseHistory,
  mergeHistory,
  sortHistory,
  stripLegacySections,
} from "./history.ts";
import { architectureOf, archFiles, isScaffold, KIND_ICON, scaffold, withArchitecture } from "./architecture.ts";
import { markdownTable } from "./table.ts";

export const KINDS = ["preference", "workflow", "script", "skill"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * Lifecycle tiers. The tier is the folder an egg lives in, not a frontmatter field,
 * so the basket's file tree shows what's on trial and what's permanent.
 *   egg      on trial: followed, but agents record how it goes
 *   chicken  hatched: permanent, followed without question
 *   cracked  rejected: kept only so it is never laid again
 */
export const TIERS = ["egg", "chicken", "cracked"] as const;
export type Tier = (typeof TIERS)[number];

const TIER_DIR: Record<Tier, string> = { egg: "eggs", chicken: "chickens", cracked: "cracked" };

/** An egg is ready to propose hatching after this many good trials and no bad ones. */
export const READY_AFTER = 3;

/** Prefix on an egg skill's description so agents know it's still on trial. */
export const TRIAL_PREFIX = "[egg: on trial] ";

export interface Egg {
  id: string;
  kind: Kind;
  tier: Tier;
  tags: string[];
  harnesses: string[];
  /** Trials under the current version of the fact; hatch readiness counts only these. */
  good: number;
  bad: number;
  /** 1 as laid; each `deveggs evolve` of the fact adds one. */
  version: number;
  laid: string; // ISO date
  updated: string; // ISO date
  /** First line of the body: the one-sentence fact. */
  summary: string;
  /** Free-form Markdown notes on the current rule. How it got here is in `<id>.history.md`. */
  body: string;
}

export interface LayInput {
  summary: string;
  /** A short name for the egg. Defaults to the first words of the summary. */
  id?: string;
  kind?: Kind;
  tags?: string[];
  harness?: string;
  note?: string;
  /** The item's architecture diagram (Markdown). Defaults to a scaffold for its kind. */
  architecture?: string;
  /** Skip the trial: the developer is already sure. */
  chicken?: boolean;
  origin?: Origin;
  today?: string;
}

/** Where an egg came from, so whoever decides to hatch it can see why it exists. */
export interface Origin {
  /** The developer's own words that prompted the egg, verbatim. */
  quote?: string;
  /** Repo (or project) the session was in. */
  repo?: string;
  /** Harness session id, if known. */
  session?: string;
}

/** Where a borrowed egg came from: someone's shared basket in a baskets repo. */
export interface BorrowedFrom {
  /** GitHub username whose shared basket it is. */
  user: string;
  /** owner/name of the baskets repo. */
  repo: string;
}

/** One trial of an egg: the verdict, and why it went that way in this scenario. */
export interface Feedback {
  good: boolean;
  harness?: string;
  repo?: string;
  session?: string;
  /** What was going on when the egg applied. */
  scenario?: string;
  /** What following the egg led to. */
  result?: string;
  /** The diagnosed cause, e.g. "too broad", "too narrow", "ambiguous wording", "missing companion". */
  cause?: string;
  /** The tuning proposed or applied, e.g. "narrow: skip design reviews". */
  tuning?: string;
  /** The developer's reaction, verbatim. */
  quote?: string;
  note?: string;
  today?: string;
}

/** Context for a hatch, crack or rename: the developer's say-so and why. */
export interface EventInput {
  harness?: string;
  repo?: string;
  session?: string;
  quote?: string;
  note?: string;
  today?: string;
}

/** A change to an item's fact, made with `deveggs evolve`. */
export interface EvolveInput {
  /** The new one-sentence fact. */
  summary: string;
  /** The developer's own words asking for the change, verbatim. */
  quote?: string;
  /** Why: the tuning, e.g. "narrow: skip design reviews". */
  note?: string;
  harness?: string;
  repo?: string;
  session?: string;
  today?: string;
}

export class BasketError extends Error {}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 8)
    .join("-");
  if (!slug) throw new BasketError(`cannot derive an id from ${JSON.stringify(text)}`);
  return slug;
}

/** Local calendar date (YYYY-MM-DD), so eggs are dated the way the developer sees the day. */
function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

const list = (value: string | undefined): string[] =>
  (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function isKind(value: string | undefined): value is Kind {
  return (KINDS as readonly string[]).includes(value ?? "");
}

export function isReady(egg: Egg): boolean {
  return egg.tier === "egg" && egg.good >= READY_AFTER && egg.bad === 0;
}

// --- serialization -----------------------------------------------------------

export function parseEgg(text: string, tier: Tier): Egg {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new BasketError("egg is missing frontmatter");
  const [, front = "", rest = ""] = match;
  const meta = new Map<string, string>();
  for (const line of front.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const id = meta.get("id");
  if (!id) throw new BasketError("egg is missing an id");
  const kind = meta.get("kind");
  if (!isKind(kind)) throw new BasketError(`egg ${id} has invalid kind ${JSON.stringify(kind)}`);
  const [summary = "", ...bodyLines] = rest.trim().split("\n");
  return {
    id,
    kind,
    tier,
    tags: list(meta.get("tags")),
    harnesses: list(meta.get("harnesses")),
    good: Number(meta.get("good") ?? "0") || 0,
    bad: Number(meta.get("bad") ?? "0") || 0,
    version: Math.max(1, Number(meta.get("version") ?? "1") || 1),
    laid: meta.get("laid") ?? today(),
    updated: meta.get("updated") ?? meta.get("laid") ?? today(),
    summary: summary.trim(),
    body: bodyLines.join("\n").trim(),
  };
}

export function serializeEgg(egg: Egg): string {
  const front = [
    `id: ${egg.id}`,
    `kind: ${egg.kind}`,
    `tags: ${egg.tags.join(", ")}`,
    `harnesses: ${egg.harnesses.join(", ")}`,
    `good: ${egg.good}`,
    `bad: ${egg.bad}`,
    // Absent means v1, so files that never evolved stay as they were.
    ...(egg.version > 1 ? [`version: ${egg.version}`] : []),
    `laid: ${egg.laid}`,
    `updated: ${egg.updated}`,
  ].join("\n");
  const body = egg.body ? `\n\n${egg.body}` : "";
  return `---\n${front}\n---\n${egg.summary}${body}\n`;
}

function skillStub(egg: Egg): string {
  const prefix = egg.tier === "egg" ? TRIAL_PREFIX : "";
  return [
    "---",
    `name: ${egg.id}`,
    `description: ${prefix}${egg.summary}`,
    "---",
    "",
    `# ${egg.id}`,
    "",
    "<!-- Write the skill here. While it's an egg, record trials with `deveggs feedback`. -->",
    "",
  ].join("\n");
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Point `` `old` `` and `[[old]]` (also `[[old|alias]]`, `[[old#part]]`) at the new id.
 * History files, and legacy `## Evolution` sections, are history and stay as written.
 * True if the file changed.
 */
function rewriteRefs(file: string, oldId: string, newId: string): boolean {
  const text = readFileSync(file, "utf8");
  const id = escapeRegExp(oldId);
  const swap = (part: string): string =>
    /^## Evolution\s*$/.test(part.split("\n")[0] ?? "")
      ? part
      : part.replace(new RegExp(`\`${id}\``, "g"), `\`${newId}\``).replace(new RegExp(`\\[\\[${id}(?=[\\]|#])`, "g"), `[[${newId}`);
  const next = text.split(/^(?=## )/m).map(swap).join("");
  if (next === text) return false;
  writeFileSync(file, next);
  return true;
}

/**
 * Rewrite a path (e.g. skills/eggs/<id>) in an item's Architecture section only; its history
 * keeps the old one. A longer id that merely starts with the same words is left alone.
 */
function repointArchitecture(body: string, from: string, to: string): string {
  const arch = architectureOf(body);
  if (arch === undefined || from === to) return body;
  const next = arch.replace(new RegExp(`${escapeRegExp(from)}(?![\\w-])`, "g"), () => to);
  return next === arch ? body : withArchitecture(body, next);
}

// --- basket ------------------------------------------------------------------

/**
 * The PREFERENCES.md index of architectures: one line on where to find them, a row per
 * workflow, script or skill (the items with moving parts) linking its diagram and files,
 * and the items whose diagram is still to draw. Simple preferences only get a row there.
 */
function architectureIndex(items: Egg[]): string[] {
  const mapped = items.filter((e) => e.kind !== "preference" && architectureOf(e.body) && !isScaffold(architectureOf(e.body)));
  const undrawn = items.filter((e) => !architectureOf(e.body) || isScaffold(architectureOf(e.body)));
  const link = (e: Egg): string => `[${e.id}](${TIER_DIR[e.tier]}/${e.id}.md#architecture)`;
  const files = (e: Egg): string => archFiles(architectureOf(e.body)).map((f) => `\`${f}\``).join(", ") || "-";
  return [
    "## 🗺 Architecture",
    "",
    "Every item opens with a diagram of what it automates: `deveggs arch <id>`.",
    ...(mapped.length ? ["", markdownTable(["", "id", "files"], mapped.map((e) => [KIND_ICON[e.kind], link(e), files(e)]))] : []),
    ...(undrawn.length ? ["", `✏️ To draw: ${undrawn.map((e) => `\`${e.id}\``).join(", ")}`] : []),
    "",
  ];
}

export class Basket {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  dir(tier: Tier): string {
    return join(this.root, TIER_DIR[tier]);
  }

  /** Skill folders are tiered the same way: <basket>/skills/{eggs,chickens,cracked}/<id>/SKILL.md */
  skillDir(tier: Tier, id?: string): string {
    const base = join(this.root, "skills", TIER_DIR[tier]);
    return id ? join(base, id) : base;
  }

  get preferencesPath(): string {
    return join(this.root, "PREFERENCES.md");
  }

  private path(tier: Tier, id: string): string {
    return join(this.dir(tier), `${id}.md`);
  }

  /** An item's history log, beside its file: <basket>/<tier>/<id>.history.md */
  historyPath(tier: Tier, id: string): string {
    return join(this.dir(tier), historyFileName(id));
  }

  private find(id: string): Tier | undefined {
    return TIERS.find((t) => existsSync(this.path(t, id)));
  }

  /** The tier holding `id`, or undefined when the basket has no such item. */
  tierOf(id: string): Tier | undefined {
    return this.find(id);
  }

  all(): Egg[] {
    return TIERS.flatMap((tier) => {
      const dir = this.dir(tier);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".md") && !isHistoryFile(f))
        .sort()
        .map((f) => parseEgg(readFileSync(join(dir, f), "utf8"), tier));
    });
  }

  get(id: string): Egg {
    const tier = this.find(id);
    if (!tier) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}`);
    return parseEgg(readFileSync(this.path(tier, id), "utf8"), tier);
  }

  private save(egg: Egg): Egg {
    mkdirSync(this.dir(egg.tier), { recursive: true });
    writeFileSync(this.path(egg.tier, egg.id), serializeEgg(egg));
    return egg;
  }

  /**
   * An item's history, oldest first. An item from before history files has its history
   * in legacy `## Origin`, `## Evolution` and `## Trials` sections; it's read from there.
   */
  history(id: string, moves: LoggedMove[] = []): HistoryEntry[] {
    const egg = this.get(id);
    const file = this.historyPath(egg.tier, id);
    if (existsSync(file) && !hasLegacySections(egg.body)) return parseHistory(readFileSync(file, "utf8"));
    const logged = existsSync(file) ? parseHistory(readFileSync(file, "utf8")) : [];
    return mergeHistory(legacyHistory(egg, existsSync(file) ? [] : moves), logged);
  }

  /** Items still keeping their history in legacy sections of the item file (or with no history file). */
  needsHistoryMigration(): Egg[] {
    return this.all().filter((egg) => hasLegacySections(egg.body) || !existsSync(this.historyPath(egg.tier, egg.id)));
  }

  /**
   * Move every item's legacy `## Origin`, `## Evolution` and `## Trials` sections into its
   * history file, losing nothing, and leave only notes and other sections in the item.
   * `moves` are hatches and cracks from the basket's git log (the item files never recorded
   * them). Items already migrated are left alone. Returns the ids migrated.
   */
  migrateHistory(moves: LoggedMove[] = []): string[] {
    return this.needsHistoryMigration().map((egg) => {
      this.adoptLegacy(egg, moves, true);
      return egg.id;
    });
  }

  /**
   * Write an item's legacy sections (if any) into its history file and drop them from the
   * item. With `start`, an item with neither gets a history begun from its frontmatter.
   */
  private adoptLegacy(egg: Egg, moves: LoggedMove[] = [], start = false): Egg {
    const file = this.historyPath(egg.tier, egg.id);
    const hasFile = existsSync(file);
    if (!hasLegacySections(egg.body) && (hasFile || !start)) return egg;
    const logged = hasFile ? parseHistory(readFileSync(file, "utf8")) : [];
    const loggedMoves = new Set(logged.filter((e) => e.event === "hatched" || e.event === "cracked").map((e) => e.event));
    const entries = mergeHistory(legacyHistory(egg, moves.filter((m) => !loggedMoves.has(m.event))), logged);
    mkdirSync(this.dir(egg.tier), { recursive: true });
    writeFileSync(file, formatHistory(egg.id, entries));
    return this.save({ ...egg, body: stripLegacySections(egg.body) });
  }

  /** Append one entry to an item's history, migrating its legacy sections first. */
  private log(egg: Egg, entry: HistoryEntry): void {
    this.adoptLegacy(this.get(egg.id), [], true);
    const file = this.historyPath(egg.tier, egg.id);
    const text = existsSync(file) ? readFileSync(file, "utf8").trimEnd() : historyHeader(egg.id);
    writeFileSync(file, `${text}

${formatEntry(entry)}
`);
  }

  /** Move an egg (and its history and skill folder, if any) to another tier. */
  private move(egg: Egg, to: Tier, date: string): Egg {
    const from = egg.tier;
    if (from === to) return egg;
    this.adoptLegacy(egg);
    rmSync(this.path(from, egg.id));
    if (existsSync(this.historyPath(from, egg.id))) {
      mkdirSync(this.dir(to), { recursive: true });
      renameSync(this.historyPath(from, egg.id), this.historyPath(to, egg.id));
    }
    egg = { ...egg, body: repointArchitecture(egg.body, `skills/${TIER_DIR[from]}/${egg.id}`, `skills/${TIER_DIR[to]}/${egg.id}`) };
    if (egg.kind === "skill" && existsSync(this.skillDir(from, egg.id))) {
      mkdirSync(this.skillDir(to), { recursive: true });
      renameSync(this.skillDir(from, egg.id), this.skillDir(to, egg.id));
      this.retitleSkill(egg.id, to);
    }
    return this.save({ ...egg, body: stripLegacySections(egg.body), tier: to, updated: date });
  }

  /** Keep the trial marker on a skill's description in sync with its tier. */
  retitleSkill(id: string, tier: Tier): void {
    const file = join(this.skillDir(tier, id), "SKILL.md");
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8").replace(/^description: (.*)$/m, (_line, desc: string) => {
      const bare = desc.startsWith(TRIAL_PREFIX) ? desc.slice(TRIAL_PREFIX.length) : desc;
      return `description: ${tier === "egg" ? TRIAL_PREFIX : ""}${bare}`;
    });
    writeFileSync(file, text);
  }

  /** Lay a new egg to try out, or a chicken straight away if the developer is already sure. */
  lay(input: LayInput): Egg {
    if (input.id !== undefined && slugify(input.id) !== input.id) {
      throw new BasketError(`invalid id ${JSON.stringify(input.id)}; use lowercase words joined by dashes, e.g. pr-screenshots`);
    }
    const id = input.id ?? slugify(input.summary);
    this.refuseExisting(id);
    const date = input.today ?? today();
    const kind = input.kind ?? "preference";
    const tier: Tier = input.chicken ? "chicken" : "egg";
    const note = input.note?.trim();
    if (note && /^## Architecture\s*$/m.test(note)) throw new BasketError("--note can't hold an ## Architecture section; pass the diagram with --arch");
    const rest = [note && (note.startsWith("## ") ? note : `## Notes\n\n${note}`)];
    const egg = this.save({
      id,
      kind,
      tier,
      tags: input.tags ?? [],
      harnesses: input.harness ? [input.harness] : [],
      good: 0,
      bad: 0,
      version: 1,
      laid: date,
      updated: date,
      summary: input.summary.trim(),
      body: withArchitecture(rest.filter(Boolean).join("\n\n"), input.architecture?.trim() || scaffold(kind, id, TIER_DIR[tier])),
    });
    const origin = input.origin ?? {};
    // A history left by an item deleted to revive its id stays: the new lay is appended to it.
    const leftover = TIERS.map((t) => this.historyPath(t, id)).find((f) => existsSync(f));
    const before = leftover ? parseHistory(readFileSync(leftover, "utf8")) : [];
    if (leftover) rmSync(leftover);
    writeFileSync(this.historyPath(egg.tier, id), formatHistory(id, [...before, {
      date,
      event: "laid",
      version: 1,
      ...(origin.quote?.trim() && { quote: origin.quote.trim() }),
      fields: cleanFields({ fact: egg.summary, harness: input.harness, repo: origin.repo, session: origin.session, ...(egg.tier === "chicken" && { tier: "chicken" }) }),
    }]));
    if (egg.kind === "skill") {
      mkdirSync(this.skillDir(egg.tier, id), { recursive: true });
      writeFileSync(join(this.skillDir(egg.tier, id), "SKILL.md"), skillStub(egg));
    }
    return egg;
  }

  /** An id already in the basket can't be laid or borrowed again; a cracked one never comes back. */
  private refuseExisting(id: string): void {
    const existing = this.find(id);
    if (existing === "cracked") throw new BasketError(`${id} was cracked (rejected) before; delete cracked/${id}.md to revive it (its history comes back with it)`);
    if (existing) throw new BasketError(`${id} is already a${existing === "egg" ? "n egg" : " chicken"}; use feedback instead`);
  }

  /**
   * Borrow an egg or chicken from someone's shared basket. It always arrives as an egg:
   * someone else's chicken hasn't been tried in this developer's loop. Trials reset to
   * ✓0 ✗0 and harnesses are dropped. Its history comes along without trials (they were
   * someone else's), plus an `imported` entry saying where it was borrowed from.
   * `history` is the shared history file's entries, if it has one; an older shared item
   * keeps its history in legacy body sections. `skill` is the item's skill folder in the
   * shared basket, copied to skills/eggs/<id>/ with the trial marker on its description.
   */
  borrow(source: Egg, from: BorrowedFrom, skill?: string, date: string = today(), history?: HistoryEntry[]): Egg {
    if (slugify(source.id) !== source.id) throw new BasketError(`invalid id ${JSON.stringify(source.id)} in ${from.user}'s basket`);
    this.refuseExisting(source.id);
    if (skill && existsSync(this.skillDir("egg", source.id))) {
      throw new BasketError(`your basket already has a skill folder ${this.skillDir("egg", source.id)}; move it away to borrow ${source.id}`);
    }
    const past = sortHistory([...(hasLegacySections(source.body) ? legacyHistory(source) : []), ...(history ?? [])]).filter((e) => e.event !== "trial");
    const imported: HistoryEntry = {
      date,
      event: "imported",
      version: source.version,
      fields: cleanFields({ fact: source.summary, from: from.user, basket: from.repo, note: `was their ${source.tier}` }),
    };
    const egg = this.save({
      ...source,
      tier: "egg",
      harnesses: [],
      good: 0,
      bad: 0,
      laid: date,
      updated: date,
      // It arrives as an egg, so its diagram's skill path follows it to skills/eggs/.
      body: repointArchitecture(stripLegacySections(source.body), `skills/${TIER_DIR[source.tier]}/${source.id}`, `skills/eggs/${source.id}`),
    });
    writeFileSync(this.historyPath("egg", egg.id), formatHistory(egg.id, [...past, imported]));
    if (skill) {
      mkdirSync(this.skillDir("egg"), { recursive: true });
      cpSync(skill, this.skillDir("egg", egg.id), { recursive: true });
      this.retitleSkill(egg.id, "egg");
    }
    return egg;
  }

  /**
   * Record how a trial of an egg went: the ✓/✗ counts in the item, and the verdict
   * (scenario, result, cause, tuning) in its history.
   */
  feedback(id: string, fb: Feedback): Egg {
    const egg = this.get(id);
    if (egg.tier !== "egg") throw new BasketError(`${id} is a ${egg.tier}, not an egg on trial`);
    const date = fb.today ?? today();
    this.log(egg, {
      date,
      event: "trial",
      version: egg.version,
      good: fb.good,
      ...(fb.quote?.trim() && { quote: fb.quote.trim() }),
      fields: cleanFields({
        harness: fb.harness,
        repo: fb.repo,
        session: fb.session,
        scenario: fb.scenario,
        result: fb.result,
        cause: fb.cause,
        tuning: fb.tuning,
        note: fb.note,
      }),
    });
    const harnesses = fb.harness && !egg.harnesses.includes(fb.harness) ? [...egg.harnesses, fb.harness] : egg.harnesses;
    return this.save({
      ...this.get(id),
      good: egg.good + (fb.good ? 1 : 0),
      bad: egg.bad + (fb.good ? 0 : 1),
      harnesses,
      updated: date,
    });
  }

  /**
   * Change an egg's or chicken's fact, keeping its id, tier, tags and history.
   * An `evolved` history entry records was/now/why with the developer's words.
   * The version goes up and the trial counts restart: trials so far were judged under the
   * old rule, so they stay in the log (under their version) but no longer count toward
   * hatching. A chicken stays a chicken.
   */
  evolve(id: string, input: EvolveInput): Egg {
    const egg = this.get(id);
    if (egg.tier === "cracked") throw new BasketError(`${id} was cracked (rejected); it doesn't evolve. Lay a new egg instead`);
    const summary = input.summary.trim();
    if (!summary) throw new BasketError("the new fact is empty");
    if (summary.includes("\n")) throw new BasketError("the new fact must be one line");
    if (summary === egg.summary) throw new BasketError(`${id} already says that`);
    const date = input.today ?? today();
    const version = egg.version + 1;
    this.log(egg, {
      date,
      event: "evolved",
      version,
      ...(input.quote?.trim() && { quote: input.quote.trim() }),
      fields: cleanFields({ harness: input.harness, repo: input.repo, session: input.session, was: egg.summary, now: summary, why: input.note }),
    });
    const harnesses = input.harness && !egg.harnesses.includes(input.harness) ? [...egg.harnesses, input.harness] : egg.harnesses;
    if (egg.kind === "skill") this.redescribeSkill(egg, summary);
    return this.save({ ...this.get(id), summary, version, good: 0, bad: 0, harnesses, updated: date });
  }

  /** A skill whose description is still the item's old fact gets the new one. */
  private redescribeSkill(egg: Egg, summary: string): void {
    const file = join(this.skillDir(egg.tier, egg.id), "SKILL.md");
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8").replace(/^description: (.*)$/m, (line, desc: string) => {
      const prefix = desc.startsWith(TRIAL_PREFIX) ? TRIAL_PREFIX : "";
      return desc.slice(prefix.length) === egg.summary ? `description: ${prefix}${summary}` : line;
    });
    writeFileSync(file, text);
  }

  /**
   * Rename an item: move its file, history and skill folder (if any) to the new id, log a
   * `renamed` entry in its history, and rewrite `` `old-id` `` and `[[old-id]]` references in the
   * other items and in skills. Its tier, version, trials and history stay as they were.
   * Returns the renamed item and the files whose references were rewritten.
   */
  rename(oldId: string, newId: string, input: EventInput = {}): { egg: Egg; rewrote: string[] } {
    if (slugify(newId) !== newId) {
      throw new BasketError(`invalid id ${JSON.stringify(newId)}; use lowercase words joined by dashes, e.g. pr-screenshots`);
    }
    const date = input.today ?? today();
    const egg = this.get(oldId);
    if (oldId === newId) throw new BasketError(`${oldId} is already called that`);
    const taken = this.find(newId);
    if (taken) throw new BasketError(`${newId} is already in the basket (${taken}); pick another id`);
    const clash = TIERS.map((t) => this.skillDir(t, newId)).find((dir) => existsSync(dir));
    if (clash) throw new BasketError(`a skill folder ${clash} already exists; move it away to rename ${oldId}`);

    // Write the new file before removing anything, so a failure never loses the item.
    const current = this.adoptLegacy(egg, [], true);
    const oldHistory = this.historyPath(egg.tier, oldId);
    const entries = existsSync(oldHistory) ? parseHistory(readFileSync(oldHistory, "utf8")) : [];
    entries.push({
      date,
      event: "renamed",
      version: egg.version,
      ...(input.quote?.trim() && { quote: input.quote.trim() }),
      fields: cleanFields({ from: oldId, to: newId, harness: input.harness, repo: input.repo, session: input.session, why: input.note }),
    });
    writeFileSync(this.historyPath(egg.tier, newId), formatHistory(newId, entries));
    const dir = `skills/${TIER_DIR[egg.tier]}/`;
    const body = repointArchitecture(current.body, `${dir}${oldId}`, `${dir}${newId}`);
    const renamed = this.save({ ...current, id: newId, updated: date, body });
    rmSync(this.path(egg.tier, oldId));
    rmSync(oldHistory, { force: true });
    const skill = this.skillDir(egg.tier, oldId);
    if (existsSync(skill)) {
      renameSync(skill, this.skillDir(egg.tier, newId));
      const file = join(this.skillDir(egg.tier, newId), "SKILL.md");
      if (existsSync(file)) {
        const old = escapeRegExp(oldId);
        const text = readFileSync(file, "utf8")
          .replace(new RegExp(`^name: ${old}$`, "m"), `name: ${newId}`)
          .replace(new RegExp(`^# ${old}$`, "m"), `# ${newId}`);
        writeFileSync(file, text);
      }
    }

    const self = this.path(egg.tier, newId);
    const rewrote = this.markdownFiles().filter((file) => file !== self && rewriteRefs(file, oldId, newId));
    return { egg: renamed, rewrote };
  }

  /** Every item file (not its history), and every Markdown file under skills/. */
  private markdownFiles(): string[] {
    const walk = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") && !isHistoryFile(e.name) ? [join(dir, e.name)] : [])
        : [];
    return [...TIERS.flatMap((t) => walk(this.dir(t))), ...walk(join(this.root, "skills"))];
  }

  /**
   * Draw (or redraw) an item's architecture: the `## Architecture` section right after
   * its fact. Its fact, tier, trials and history stay as they were.
   */
  draw(id: string, architecture: string, date: string = today()): Egg {
    const egg = this.get(id);
    return this.save({ ...egg, updated: date, body: withArchitecture(egg.body, architecture) });
  }

  /** The developer liked it: hatch the egg into a permanent chicken. */
  hatch(id: string, input: EventInput = {}): Egg {
    const egg = this.get(id);
    if (egg.tier !== "egg") throw new BasketError(`${id} is a ${egg.tier}; only eggs hatch`);
    return this.moveLogged(egg, "chicken", "hatched", input);
  }

  /** Reject an egg (or retire a chicken). Kept so it is never laid again. */
  crack(id: string, input: EventInput = {}): Egg {
    const egg = this.get(id);
    if (egg.tier === "cracked") throw new BasketError(`${id} is already cracked`);
    return this.moveLogged(egg, "cracked", "cracked", input);
  }

  private moveLogged(egg: Egg, to: Tier, event: "hatched" | "cracked", input: EventInput): Egg {
    const date = input.today ?? today();
    this.log(egg, {
      date,
      event,
      version: egg.version,
      ...(input.quote?.trim() && { quote: input.quote.trim() }),
      fields: cleanFields({
        harness: input.harness,
        repo: input.repo,
        session: input.session,
        trials: `✓${egg.good} ✗${egg.bad} (v${egg.version})`,
        why: input.note,
      }),
    });
    return this.move(this.get(egg.id), to, date);
  }

  /** Render chickens (permanent) and eggs (on trial) into PREFERENCES.md, as Markdown tables. */
  render(): string {
    const byTag = (tier: Tier): Egg[] =>
      this.all()
        .filter((e) => e.tier === tier)
        .sort((a, b) => (a.tags[0] ?? "general").localeCompare(b.tags[0] ?? "general") || a.id.localeCompare(b.id));
    const fact = (e: Egg): string => (e.kind === "preference" ? e.summary : `${e.summary} _(${e.kind})_`);
    const tags = (e: Egg): string => e.tags.join(", ") || "general";
    const chickens = byTag("chicken");
    const eggs = byTag("egg");
    const section = (rows: Egg[], table: () => string): string => (rows.length ? table() : "_None yet._");
    const out = [
      "# Developer preferences",
      "",
      "<!-- Generated by `deveggs render` from chickens/ and eggs/. Do not edit by hand. -->",
      "",
      "## 🐔 Chickens: permanent",
      "",
      "Follow these. They outrank any harness-local memory.",
      "",
      section(chickens, () => markdownTable(["id", "fact", "tags"], chickens.map((e) => [`\`${e.id}\``, fact(e), tags(e)]))),
      "",
      "## 🥚 Eggs: on trial",
      "",
      "Follow these too, but they're experiments. When one clearly helps or hurts, record it:",
      "`deveggs feedback <id> --good|--bad --note \"…\"`. A chicken wins if an egg conflicts with it.",
      `🐣 marks an egg ready to propose hatching (${READY_AFTER} ✓ and no ✗).`,
      "",
      section(eggs, () =>
        markdownTable(
          ["", "id", "fact", "tags", "trials"],
          eggs.map((e) => [isReady(e) ? "🐣" : "🥚", `\`${e.id}\``, fact(e), tags(e), `✓${e.good} ✗${e.bad}${e.version > 1 ? ` (v${e.version})` : ""}`]),
        )),
      "",
      ...architectureIndex([...chickens, ...eggs]),
    ].join("\n");
    writeFileSync(this.preferencesPath, out);
    return out;
  }
}
