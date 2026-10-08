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
  good: number;
  bad: number;
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
    const entry = `- ${date} ${fb.good ? "✓" : "✗"}${via}${fb.note ? ` ${fb.note.trim()}` : ""}`;
    const hasLog = /^## Trials$/m.test(egg.body);
    const body = hasLog ? `${egg.body}\n${entry}` : `${egg.body}${egg.body ? "\n\n" : ""}## Trials\n\n${entry}`;
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
          eggs.map((e) => [isReady(e) ? "🐣" : "🥚", `\`${e.id}\``, fact(e), tags(e), `✓${e.good} ✗${e.bad}`]),
        )),
      "",
    ].join("\n");
    writeFileSync(this.preferencesPath, out);
    return out;
  }
}
