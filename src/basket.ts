import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  /** Free-form Markdown: notes, then the trial log. */
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

export interface Feedback {
  good: boolean;
  harness?: string;
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

/** One entry of an item's `## Evolution` section. */
export interface Evolution {
  /** The version this entry made, 2 and up. */
  version: number;
  date: string;
  /** harness · repo · session id, as in an Origin row. */
  context: string[];
  quote: string;
  was: string;
  now: string;
  why: string;
  /** Set on a rename entry: the id the item had before. Its version is 0 and was/now are empty. */
  renamedFrom?: string;
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

export function formatOrigin(date: string, harness: string | undefined, origin: Origin): string {
  const quote = origin.quote?.trim();
  const where = [date, harness, origin.repo, origin.session && `session ${origin.session}`].filter(Boolean);
  const lines = ["## Origin", ""];
  if (quote) lines.push(...quote.split("\n").map((l) => `> ${l}`), "");
  lines.push(`- ${where.join(" · ")}`);
  return lines.join("\n");
}

const quoteLines = (quote: string): string[] => quote.split("\n").map((l) => `> ${l}`);

/**
 * One `## Evolution` entry: a `### vN · date · context` heading, the quote, then was/now/why.
 * A rename (`deveggs rename`) is a `### renamed · date` heading and a `- renamed from:` line.
 */
export function formatEvolution(e: Evolution): string {
  const lines = [`### ${[e.renamedFrom ? "renamed" : `v${e.version}`, e.date, ...e.context].join(" · ")}`, ""];
  if (e.quote) lines.push(...quoteLines(e.quote), "");
  if (e.renamedFrom) lines.push(`- renamed from: \`${e.renamedFrom}\``);
  else lines.push(`- was: ${e.was}`, `- now: ${e.now}`);
  if (e.why) lines.push(`- why: ${e.why}`);
  return lines.join("\n");
}

/** The entries of an item's `## Evolution` section, oldest first. */
export function parseEvolution(body: string): Evolution[] {
  const section = sectionOf(body, "Evolution");
  if (!section) return [];
  return section
    .split(/^(?=### )/m)
    .filter((entry) => entry.startsWith("### "))
    .map((entry) => {
      const [heading = "", ...lines] = entry.trim().split("\n");
      const [v = "", date = "", ...context] = heading.slice(4).split(" · ").map((s) => s.trim());
      const field = (name: string): string => lines.find((l) => l.startsWith(`- ${name}: `))?.slice(name.length + 4).trim() ?? "";
      const renamed = v === "renamed" ? { renamedFrom: field("renamed from").replace(/^`|`$/g, "") } : {};
      return {
        ...renamed,
        version: Number(v.replace(/^v/, "")) || 0,
        date,
        context,
        quote: lines.filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n").trim(),
        was: field("was"),
        now: field("now"),
        why: field("why"),
      };
    });
}

/** The text of a `## <name>` section of a body (heading included), or undefined. */
function sectionOf(body: string, name: string): string | undefined {
  return body.split(/^(?=## )/m).find((part) => new RegExp(`^## ${name}\\s*$`).test(part.split("\n")[0] ?? ""));
}

/**
 * Add an entry to the body's `## Evolution` section, creating it if needed. The section
 * goes before `## Trials`: feedback appends to the end of the body, so the log stays last.
 */
function addEvolution(body: string, entry: string): string {
  const parts = body.split(/^(?=## )/m).map((part) => part.trim()).filter(Boolean);
  const heading = (part: string): string => part.split("\n")[0] ?? "";
  const at = parts.findIndex((part) => /^## Evolution\s*$/.test(heading(part)));
  if (at >= 0) parts[at] = `${parts[at]}\n\n${entry}`;
  else {
    const trials = parts.findIndex((part) => /^## Trials\s*$/.test(heading(part)));
    parts.splice(trials >= 0 ? trials : parts.length, 0, `## Evolution\n\n${entry}`);
  }
  return parts.join("\n\n");
}

/** The version the last trials in a log were recorded under: its last `### vN` marker, or 1. */
function loggedVersion(body: string): number {
  const log = sectionOf(body, "Trials") ?? "";
  const markers = [...log.matchAll(/^### v(\d+)\s*$/gm)].map((m) => Number(m[1]));
  return markers.at(-1) ?? 1;
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

/** Point `` `old` `` and `[[old]]` (also `[[old|alias]]`, `[[old#part]]`) at the new id. True if the file changed. */
function rewriteRefs(file: string, oldId: string, newId: string): boolean {
  const text = readFileSync(file, "utf8");
  const id = escapeRegExp(oldId);
  const next = text.replace(new RegExp(`\`${id}\``, "g"), `\`${newId}\``).replace(new RegExp(`\\[\\[${id}(?=[\\]|#])`, "g"), `[[${newId}`);
  if (next === text) return false;
  writeFileSync(file, next);
  return true;
}

// --- basket ------------------------------------------------------------------

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
        .filter((f) => f.endsWith(".md"))
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

  /** Move an egg (and its skill folder, if any) to another tier. */
  private move(egg: Egg, to: Tier, date: string): Egg {
    const from = egg.tier;
    if (from === to) return egg;
    rmSync(this.path(from, egg.id));
    if (egg.kind === "skill" && existsSync(this.skillDir(from, egg.id))) {
      mkdirSync(this.skillDir(to), { recursive: true });
      renameSync(this.skillDir(from, egg.id), this.skillDir(to, egg.id));
      this.retitleSkill(egg.id, to);
    }
    return this.save({ ...egg, tier: to, updated: date });
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
    const egg = this.save({
      id,
      kind: input.kind ?? "preference",
      tier: input.chicken ? "chicken" : "egg",
      tags: input.tags ?? [],
      harnesses: input.harness ? [input.harness] : [],
      good: 0,
      bad: 0,
      version: 1,
      laid: date,
      updated: date,
      summary: input.summary.trim(),
      body: [input.note?.trim(), formatOrigin(date, input.harness, input.origin ?? {})].filter(Boolean).join("\n\n"),
    });
    if (egg.kind === "skill") {
      mkdirSync(this.skillDir(egg.tier, id), { recursive: true });
      writeFileSync(join(this.skillDir(egg.tier, id), "SKILL.md"), skillStub(egg));
    }
    return egg;
  }

  /** An id already in the basket can't be laid or borrowed again; a cracked one never comes back. */
  private refuseExisting(id: string): void {
    const existing = this.find(id);
    if (existing === "cracked") throw new BasketError(`${id} was cracked (rejected) before; delete it to revive`);
    if (existing) throw new BasketError(`${id} is already a${existing === "egg" ? "n egg" : " chicken"}; use feedback instead`);
  }

  /**
   * Borrow an egg or chicken from someone's shared basket. It always arrives as an egg:
   * someone else's chicken hasn't been tried in this developer's loop. Trials reset to
   * ✓0 ✗0, the trial log and harnesses are dropped, and its Origin gets a row saying
   * where it was borrowed from. `skill` is the item's skill folder in the shared basket,
   * copied to skills/eggs/<id>/ with the trial marker on its description.
   */
  borrow(source: Egg, from: BorrowedFrom, skill?: string, date: string = today()): Egg {
    if (slugify(source.id) !== source.id) throw new BasketError(`invalid id ${JSON.stringify(source.id)} in ${from.user}'s basket`);
    this.refuseExisting(source.id);
    if (skill && existsSync(this.skillDir("egg", source.id))) {
      throw new BasketError(`your basket already has a skill folder ${this.skillDir("egg", source.id)}; move it away to borrow ${source.id}`);
    }
    const row = `- ${date} · borrowed from ${from.user} · ${from.repo}`;
    const parts = source.body.split(/^(?=## )/m).filter((part) => !/^## Trials\s*$/m.test(part.split("\n")[0] ?? ""));
    const origin = parts.findIndex((part) => /^## Origin\s*$/.test(part.split("\n")[0] ?? ""));
    if (origin >= 0) parts[origin] = `${(parts[origin] ?? "").trimEnd()}\n${row}`;
    else parts.push(`## Origin\n\n${row}`);
    const egg = this.save({
      ...source,
      tier: "egg",
      harnesses: [],
      good: 0,
      bad: 0,
      laid: date,
      updated: date,
      body: parts.map((part) => part.trim()).filter(Boolean).join("\n\n"),
    });
    if (skill) {
      mkdirSync(this.skillDir("egg"), { recursive: true });
      cpSync(skill, this.skillDir("egg", egg.id), { recursive: true });
      this.retitleSkill(egg.id, "egg");
    }
    return egg;
  }

  /** Record how a trial of an egg went. */
  feedback(id: string, fb: Feedback): Egg {
    const egg = this.get(id);
    if (egg.tier !== "egg") throw new BasketError(`${id} is a ${egg.tier}, not an egg on trial`);
    const date = fb.today ?? today();
    const via = fb.harness ? ` (${fb.harness})` : "";
    const trial = `- ${date} ${fb.good ? "✓" : "✗"}${via}${fb.note ? ` ${fb.note.trim()}` : ""}`;
    // Trials after an evolution go under a `### vN` marker, so earlier ones stay with their version.
    const hasLog = /^## Trials$/m.test(egg.body);
    const marker = egg.version > (hasLog ? loggedVersion(egg.body) : 1) ? `### v${egg.version}\n\n` : "";
    const entry = marker ? `\n${marker}${trial}` : trial;
    const body = hasLog ? `${egg.body}\n${entry}` : `${egg.body}${egg.body ? "\n\n" : ""}## Trials\n\n${marker}${trial}`;
    const harnesses = fb.harness && !egg.harnesses.includes(fb.harness) ? [...egg.harnesses, fb.harness] : egg.harnesses;
    return this.save({
      ...egg,
      good: egg.good + (fb.good ? 1 : 0),
      bad: egg.bad + (fb.good ? 0 : 1),
      harnesses,
      body,
      updated: date,
    });
  }

  /**
   * Change an egg's or chicken's fact, keeping its id, tier, tags, origin and trial log.
   * The old wording goes into an `## Evolution` entry with the developer's words and why.
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
    const context = [input.harness, input.repo, input.session && `session ${input.session}`].filter((s): s is string => Boolean(s));
    const entry = formatEvolution({
      version,
      date,
      context,
      quote: input.quote?.trim() ?? "",
      was: egg.summary,
      now: summary,
      why: input.note?.trim().replace(/\s*\n\s*/g, " ") ?? "",
    });
    const harnesses = input.harness && !egg.harnesses.includes(input.harness) ? [...egg.harnesses, input.harness] : egg.harnesses;
    if (egg.kind === "skill") this.redescribeSkill(egg, summary);
    return this.save({ ...egg, summary, version, good: 0, bad: 0, harnesses, updated: date, body: addEvolution(egg.body, entry) });
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
   * Rename an item: move its file (and skill folder, if any) to the new id, record the old
   * id under `## Evolution`, and rewrite `` `old-id` `` and `[[old-id]]` references in the
   * other items and in skills. Its tier, version, trials and history stay as they were.
   * Returns the renamed item and the files whose references were rewritten.
   */
  rename(oldId: string, newId: string, date: string = today()): { egg: Egg; rewrote: string[] } {
    if (slugify(newId) !== newId) {
      throw new BasketError(`invalid id ${JSON.stringify(newId)}; use lowercase words joined by dashes, e.g. pr-screenshots`);
    }
    const egg = this.get(oldId);
    if (oldId === newId) throw new BasketError(`${oldId} is already called that`);
    const taken = this.find(newId);
    if (taken) throw new BasketError(`${newId} is already in the basket (${taken}); pick another id`);
    const clash = TIERS.map((t) => this.skillDir(t, newId)).find((dir) => existsSync(dir));
    if (clash) throw new BasketError(`a skill folder ${clash} already exists; move it away to rename ${oldId}`);

    const skill = this.skillDir(egg.tier, oldId);
    if (existsSync(skill)) {
      renameSync(skill, this.skillDir(egg.tier, newId));
      const file = join(this.skillDir(egg.tier, newId), "SKILL.md");
      if (existsSync(file)) {
        const text = readFileSync(file, "utf8")
          .replace(new RegExp(`^name: ${oldId}$`, "m"), `name: ${newId}`)
          .replace(new RegExp(`^# ${oldId}$`, "m"), `# ${newId}`);
        writeFileSync(file, text);
      }
    }
    rmSync(this.path(egg.tier, oldId));
    const entry = formatEvolution({ version: 0, date, context: [], quote: "", was: "", now: "", why: "", renamedFrom: oldId });
    const renamed = this.save({ ...egg, id: newId, updated: date, body: addEvolution(egg.body, entry) });

    const self = this.path(egg.tier, newId);
    const rewrote = this.markdownFiles().filter((file) => file !== self && rewriteRefs(file, oldId, newId));
    return { egg: renamed, rewrote };
  }

  /** Every item file, and every Markdown file under skills/. */
  private markdownFiles(): string[] {
    const walk = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [])
        : [];
    return [...TIERS.flatMap((t) => walk(this.dir(t))), ...walk(join(this.root, "skills"))];
  }

  /** The developer liked it: hatch the egg into a permanent chicken. */
  hatch(id: string, date: string = today()): Egg {
    const egg = this.get(id);
    if (egg.tier !== "egg") throw new BasketError(`${id} is a ${egg.tier}; only eggs hatch`);
    return this.move(egg, "chicken", date);
  }

  /** Reject an egg (or retire a chicken). Kept so it is never laid again. */
  crack(id: string, date: string = today()): Egg {
    return this.move(this.get(id), "cracked", date);
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
    ].join("\n");
    writeFileSync(this.preferencesPath, out);
    return out;
  }
}
