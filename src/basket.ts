import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const KINDS = ["preference", "workflow", "script", "skill"] as const;
export type Kind = (typeof KINDS)[number];

export const STATUSES = ["egg", "hatched", "cracked"] as const;
export type Status = (typeof STATUSES)[number];

/** How the egg was laid. Explicit = the developer said it outright; inferred = an agent noticed it. */
export const SOURCES = ["explicit", "inferred"] as const;
export type Source = (typeof SOURCES)[number];

/** An inferred egg is "warm" (ready to propose hatching) once seen this many times. */
export const WARM_THRESHOLD = 2;

export interface Egg {
  id: string;
  kind: Kind;
  status: Status;
  source: Source;
  tags: string[];
  sightings: number;
  harnesses: string[];
  laid: string; // ISO date
  updated: string; // ISO date
  /** First line of the body: the one-sentence fact. */
  summary: string;
  /** Free-form Markdown notes / evidence. */
  body: string;
}

export interface LayInput {
  summary: string;
  kind?: Kind;
  source?: Source;
  tags?: string[];
  harness?: string;
  body?: string;
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneOf<T extends string>(allowed: readonly T[], value: string | undefined, field: string): T {
  if (value !== undefined && (allowed as readonly string[]).includes(value)) return value as T;
  throw new BasketError(`invalid ${field} ${JSON.stringify(value)}; expected one of ${allowed.join(", ")}`);
}

const list = (value: string | undefined): string[] =>
  (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// --- serialization -----------------------------------------------------------

export function parseEgg(text: string): Egg {
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
  const [summary = "", ...bodyLines] = rest.trim().split("\n");
  return {
    id,
    kind: oneOf(KINDS, meta.get("kind"), "kind"),
    status: oneOf(STATUSES, meta.get("status"), "status"),
    source: oneOf(SOURCES, meta.get("source"), "source"),
    tags: list(meta.get("tags")),
    sightings: Number(meta.get("sightings") ?? "1") || 1,
    harnesses: list(meta.get("harnesses")),
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
    `status: ${egg.status}`,
    `source: ${egg.source}`,
    `tags: ${egg.tags.join(", ")}`,
    `sightings: ${egg.sightings}`,
    `harnesses: ${egg.harnesses.join(", ")}`,
    `laid: ${egg.laid}`,
    `updated: ${egg.updated}`,
  ].join("\n");
  const body = egg.body ? `\n\n${egg.body}` : "";
  return `---\n${front}\n---\n${egg.summary}${body}\n`;
}

// --- basket ------------------------------------------------------------------

export class Basket {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  get eggsDir(): string {
    return join(this.root, "eggs");
  }

  get preferencesPath(): string {
    return join(this.root, "PREFERENCES.md");
  }

  get skillsDir(): string {
    return join(this.root, "skills");
  }

  private path(id: string): string {
    return join(this.eggsDir, `${id}.md`);
  }

  all(): Egg[] {
    if (!existsSync(this.eggsDir)) return [];
    return readdirSync(this.eggsDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => parseEgg(readFileSync(join(this.eggsDir, f), "utf8")));
  }

  get(id: string): Egg {
    const p = this.path(id);
    if (!existsSync(p)) throw new BasketError(`no egg named ${JSON.stringify(id)}`);
    return parseEgg(readFileSync(p, "utf8"));
  }

  save(egg: Egg): Egg {
    mkdirSync(this.eggsDir, { recursive: true });
    writeFileSync(this.path(egg.id), serializeEgg(egg));
    return egg;
  }

  /**
   * Lay a new egg. Explicit eggs hatch immediately: the developer said it on purpose.
   * Laying an egg that already exists warms it instead; a cracked egg is never re-laid.
   */
  lay(input: LayInput): Egg {
    const id = slugify(input.summary);
    const date = input.today ?? today();
    if (existsSync(this.path(id))) {
      const existing = this.get(id);
      if (existing.status === "cracked") {
        throw new BasketError(`${id} was cracked (rejected) before; edit or delete it to revive`);
      }
      return this.warm(id, input.harness, date);
    }
    const source = input.source ?? "inferred";
    return this.save({
      id,
      kind: input.kind ?? "preference",
      status: source === "explicit" ? "hatched" : "egg",
      source,
      tags: input.tags ?? [],
      sightings: 1,
      harnesses: input.harness ? [input.harness] : [],
      laid: date,
      updated: date,
      summary: input.summary.trim(),
      body: input.body?.trim() ?? "",
    });
  }

  /** Record another sighting of an egg, optionally from another harness. */
  warm(id: string, harness?: string, date: string = today()): Egg {
    const egg = this.get(id);
    egg.sightings += 1;
    if (harness && !egg.harnesses.includes(harness)) egg.harnesses.push(harness);
    egg.updated = date;
    return this.save(egg);
  }

  hatch(id: string, date: string = today()): Egg {
    return this.save({ ...this.get(id), status: "hatched", updated: date });
  }

  crack(id: string, date: string = today()): Egg {
    return this.save({ ...this.get(id), status: "cracked", updated: date });
  }

  /** Inferred eggs seen often enough that the agent should propose hatching them. */
  warmEggs(): Egg[] {
    return this.all().filter((e) => e.status === "egg" && e.sightings >= WARM_THRESHOLD);
  }

  /** Render hatched preference eggs into PREFERENCES.md, grouped by first tag. */
  render(): string {
    const groups = new Map<string, Egg[]>();
    for (const egg of this.all()) {
      if (egg.status !== "hatched" || egg.kind !== "preference") continue;
      const tag = egg.tags[0] ?? "general";
      groups.set(tag, [...(groups.get(tag) ?? []), egg]);
    }
    const sections = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, eggs]) => `## ${tag}\n\n${eggs.map((e) => `- ${e.summary}`).join("\n")}`);
    const out = [
      "# Developer preferences",
      "",
      "<!-- Generated by `deveggs render` from hatched eggs in basket/eggs/. Do not edit by hand. -->",
      "",
      sections.length ? sections.join("\n\n") : "_No hatched preferences yet._",
      "",
    ].join("\n");
    writeFileSync(this.preferencesPath, out);
    return out;
  }
}
