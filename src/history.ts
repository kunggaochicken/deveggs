import type { Egg } from "./basket.ts";

/**
 * An item's history: `<tier>/<id>.history.md`, beside `<tier>/<id>.md`. The item file
 * holds the current rule; the history is the append-only, chronological log of how it
 * got there: where it came from, every trial with its verdict, every evolve, and every
 * hatch, crack, rename and import. deveggs appends to it; nobody edits it by hand.
 *
 * Each entry is a `## <date> · <event> · v<N>` heading, then the developer's words as a
 * `>` quote, then `- key: value` fields, then any free text:
 *
 *   ## 2026-10-09 · trial ✗ · v1
 *
 *   - harness: claude
 *   - repo: grover
 *   - scenario: asked to spec ideas mid-build
 *   - result: paused the build and brainstormed inline
 *   - cause: too narrow
 *   - tuning: widen: cover new requests that arrive mid-task
 */

export const EVENTS = ["laid", "trial", "evolved", "hatched", "cracked", "renamed", "imported"] as const;
export type HistoryEvent = (typeof EVENTS)[number];

/** Field order in a written entry; unknown fields (from newer tools) keep their place after these. */
export const FIELDS = [
  "fact",
  "tier",
  "from",
  "to",
  "basket",
  "harness",
  "repo",
  "session",
  "scenario",
  "result",
  "cause",
  "tuning",
  "was",
  "now",
  "why",
  "trials",
  "note",
] as const;

export interface HistoryEntry {
  date: string;
  event: HistoryEvent;
  /** The version of the fact the event concerns; for `evolved`, the version it made. */
  version: number;
  /** Trials only: ✓ or ✗. */
  good?: boolean;
  /** The developer's words, verbatim. */
  quote?: string;
  /** One-line values, written in FIELDS order. */
  fields: Record<string, string>;
  /** Anything else under the entry, kept as written. */
  text?: string;
}

export const historyFileName = (id: string): string => `${id}.history.md`;
export const isHistoryFile = (name: string): boolean => name.endsWith(".history.md");

const oneLine = (value: string): string => value.trim().replace(/\s*\n\s*/g, " ");

/** Drop empty fields and fold values onto one line. */
export function cleanFields(fields: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value.trim()) out[key] = oneLine(value);
  return out;
}

function label(e: HistoryEntry): string {
  return e.event === "trial" ? `trial ${e.good ? "✓" : "✗"}` : e.event;
}

export function formatEntry(e: HistoryEntry): string {
  const lines = [`## ${[e.date, label(e), `v${e.version}`].join(" · ")}`, ""];
  const quote = e.quote?.trim();
  if (quote) lines.push(...quote.split("\n").map((l) => `> ${l}`.trimEnd()), "");
  const known = (FIELDS as readonly string[]).filter((k) => e.fields[k]);
  const extra = Object.keys(e.fields).filter((k) => !(FIELDS as readonly string[]).includes(k) && e.fields[k]);
  const fields = [...known, ...extra].map((k) => `- ${k}: ${e.fields[k]}`);
  if (fields.length) lines.push(...fields, "");
  if (e.text?.trim()) lines.push(e.text.trim(), "");
  return lines.join("\n").trimEnd();
}

export function historyHeader(id: string): string {
  return [
    `# ${id}: history`,
    "",
    "<!-- Append-only log written by deveggs, oldest first. Read it with: deveggs history " + id + " -->",
  ].join("\n");
}

export function formatHistory(id: string, entries: HistoryEntry[]): string {
  return [historyHeader(id), ...entries.map(formatEntry)].join("\n\n") + "\n";
}

const HEADING = /^## (\d{4}-\d{2}-\d{2}|[^ ·]+) · (.+?) · v(\d+)\s*$/;

export function parseHistory(text: string): HistoryEntry[] {
  return text
    .split(/^(?=## )/m)
    .filter((part) => part.startsWith("## "))
    .flatMap((part): HistoryEntry[] => {
      const [heading = "", ...lines] = part.trimEnd().split("\n");
      const m = HEADING.exec(heading);
      if (!m) return [];
      const [, date = "", what = "", v = "1"] = m;
      const trial = /^trial ([✓✗])$/.exec(what);
      const event = (trial ? "trial" : what) as HistoryEvent;
      if (!(EVENTS as readonly string[]).includes(event)) return [];
      const quote: string[] = [];
      const fields: Record<string, string> = {};
      const text: string[] = [];
      for (const line of lines) {
        const field = /^- ([a-z][\w-]*): (.*)$/.exec(line);
        if (!text.length && /^>/.test(line)) quote.push(line.replace(/^> ?/, ""));
        else if (!text.length && field) fields[field[1] ?? ""] = (field[2] ?? "").trim();
        else if (line.trim() || text.length) text.push(line);
      }
      return [{
        date,
        event,
        version: Number(v) || 1,
        ...(trial && { good: trial[1] === "✓" }),
        ...(quote.length && { quote: quote.join("\n").trim() }),
        fields,
        ...(text.join("\n").trim() && { text: text.join("\n").trim() }),
      }];
    });
}

// --- filtering -------------------------------------------------------------------

export interface HistoryFilter {
  events?: HistoryEvent[];
  /** Only entries on or after this date (YYYY-MM-DD). */
  since?: string;
  /** Only entries about this version. */
  version?: number;
}

export function filterHistory(entries: HistoryEntry[], f: HistoryFilter): HistoryEntry[] {
  return entries.filter((e) =>
    (!f.events?.length || f.events.includes(e.event)) && (!f.since || e.date >= f.since) && (f.version === undefined || e.version === f.version));
}

/** Trial counts per version, from the log. */
export function trialsByVersion(entries: HistoryEntry[]): Map<number, { good: number; bad: number }> {
  const out = new Map<number, { good: number; bad: number }>();
  for (const e of entries.filter((x) => x.event === "trial")) {
    const n = out.get(e.version) ?? { good: 0, bad: 0 };
    if (e.good) n.good++;
    else n.bad++;
    out.set(e.version, n);
  }
  return new Map([...out].sort(([a], [b]) => a - b));
}

// --- legacy: the `## Origin`, `## Evolution` and `## Trials` sections ----------------

/** Sections that moved out of the item file into its history. */
export const LEGACY_SECTIONS = ["Origin", "Evolution", "Trials"] as const;

const headingOf = (part: string): string => /^## (.*)$/.exec(part.split("\n")[0] ?? "")?.[1]?.trim() ?? "";

export function hasLegacySections(body: string): boolean {
  return body.split(/^(?=## )/m).some((part) => part.startsWith("## ") && (LEGACY_SECTIONS as readonly string[]).includes(headingOf(part)));
}

/** The item body without its Origin, Evolution and Trials sections: notes and any other sections. */
export function stripLegacySections(body: string): string {
  return body
    .split(/^(?=## )/m)
    .filter((part) => !(part.startsWith("## ") && (LEGACY_SECTIONS as readonly string[]).includes(headingOf(part))))
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Read a `harness · repo · session X` context list the way lay and evolve wrote it. */
function context(parts: string[], harnesses: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const rest: string[] = [];
  for (const part of parts.map((s) => s.trim()).filter(Boolean)) {
    if (part.startsWith("session ")) out["session"] = part.slice(8).trim();
    else rest.push(part);
  }
  if (rest.length >= 2) {
    out["harness"] = rest[0] ?? "";
    out["repo"] = rest.slice(1).join(" · ");
  } else if (rest.length === 1) {
    out[harnesses.includes(rest[0] ?? "") ? "harness" : "repo"] = rest[0] ?? "";
  }
  return out;
}

const TRIAL_LINE = /^- (\d{4}-\d{2}-\d{2}) ([✓✗])(?: \(([^)]*)\))?(?: (.*))?$/;

export const isDate = (text: string | undefined): text is string => /^\d{4}-\d{2}-\d{2}$/.test(text ?? "");

/** A hatch or crack the basket's git log recorded, for items whose file never did. */
export interface LoggedMove {
  id: string;
  event: "hatched" | "cracked";
  date: string;
}

/**
 * Convert an item's legacy sections into history entries, oldest first, without losing
 * anything: lines the converter doesn't recognize are kept as free text on the laid entry.
 * `moves` adds the hatches and cracks the basket's git log knows about.
 */
export function legacyHistory(egg: Egg, moves: LoggedMove[] = []): HistoryEntry[] {
  const parts = egg.body.split(/^(?=## )/m);
  const section = (name: string): string[] =>
    parts.filter((p) => p.startsWith("## ") && headingOf(p) === name).flatMap((p) => p.split("\n").slice(1));
  const leftovers: string[] = [];
  const keep = (from: string, lines: string[]): void => {
    const kept = lines.filter((l) => l.trim());
    if (kept.length) leftovers.push(`(from ## ${from})`, ...kept);
  };

  // Evolution: `### vN · date · context` (or `### renamed · date`), quote, was/now/why.
  const evolved: HistoryEntry[] = [];
  const evoLines = section("Evolution");
  const evoBlocks = evoLines.join("\n").split(/^(?=### )/m);
  keep("Evolution", (evoBlocks[0] ?? "").startsWith("### ") ? [] : (evoBlocks[0] ?? "").split("\n"));
  for (const block of evoBlocks.filter((b) => b.startsWith("### "))) {
    const [heading = "", ...lines] = block.trimEnd().split("\n");
    const [v = "", rawDate = "", ...ctx] = heading.slice(4).split(" · ").map((s) => s.trim());
    // A heading without a real date keeps its place by the item's last update, and its text.
    const date = isDate(rawDate) ? rawDate : egg.updated;
    if (!isDate(rawDate)) ctx.unshift(rawDate);
    const quote = lines.filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n").trim();
    const fields: Record<string, string> = {};
    const other: string[] = [];
    for (const line of lines.filter((l) => !l.startsWith(">") && l.trim())) {
      const f = /^- (was|now|why|renamed from): (.*)$/.exec(line);
      if (f?.[1] === "renamed from") fields["from"] = (f[2] ?? "").replace(/^`|`$/g, "").trim();
      else if (f) fields[f[1] ?? ""] = (f[2] ?? "").trim();
      else other.push(line);
    }
    const renamed = v === "renamed";
    evolved.push({
      date,
      event: renamed ? "renamed" : "evolved",
      version: renamed ? 0 : Number(v.replace(/^v/, "")) || 2,
      ...(quote && { quote }),
      fields: { ...context(ctx.filter(Boolean), egg.harnesses), ...fields },
      ...(other.length && { text: other.join("\n") }),
    });
  }
  const evolves = evolved.filter((e) => e.event === "evolved").sort((a, b) => a.version - b.version);
  const versionOn = (date: string): number => evolves.filter((e) => e.date <= date).at(-1)?.version ?? 1;
  // A legacy rename names only the old id; the new one is the next rename's old id, or today's id.
  const renames = evolved.filter((x) => x.event === "renamed");
  renames.forEach((e, i) => {
    e.version = versionOn(e.date);
    e.fields = { from: e.fields["from"] ?? "", to: renames[i + 1]?.fields["from"] ?? egg.id, ...e.fields };
  });

  // Origin: the quote, then `- date · harness · repo · session` and `- date · borrowed from user · repo` rows.
  const origin = section("Origin");
  const quote = origin.filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n").trim();
  const dated = (l: string): boolean => isDate(l.slice(2).split(" · ")[0]?.trim());
  const rows = origin.filter((l) => l.startsWith("- ") && dated(l)).map((l) => l.slice(2).split(" · ").map((s) => s.trim()));
  keep("Origin", origin.filter((l) => !l.startsWith(">") && !(l.startsWith("- ") && dated(l))));
  const firstFact = evolves[0]?.fields["was"] || egg.summary;
  const laidRow = rows.find((r) => !/^borrowed from /.test(r[1] ?? ""));
  // Without its own row (an item borrowed before history files), a lay is dated no later than anything after it.
  const earliest = [egg.laid, ...rows.map((r) => r[0] ?? ""), ...evolved.map((e) => e.date)].filter(isDate).sort()[0] ?? egg.laid;
  const laid: HistoryEntry = {
    date: laidRow?.[0] || earliest,
    event: "laid",
    version: 1,
    ...(quote && { quote }),
    fields: { fact: firstFact, ...context(laidRow?.slice(1) ?? [], egg.harnesses) },
  };
  const imports: HistoryEntry[] = rows
    .filter((r) => /^borrowed from /.test(r[1] ?? ""))
    .map((r) => ({
      date: r[0] ?? egg.laid,
      event: "imported" as const,
      version: versionOn(r[0] ?? egg.laid),
      fields: cleanFields({ from: (r[1] ?? "").replace(/^borrowed from /, ""), basket: r.slice(2).join(" · ") }),
    }));
  for (const extra of rows.filter((r) => r !== laidRow && !/^borrowed from /.test(r[1] ?? ""))) leftovers.push(`(from ## Origin) - ${extra.join(" · ")}`);

  // Trials: `- date ✓ (harness) note`, under `### vN` markers after an evolve.
  const trials: HistoryEntry[] = [];
  let version = 1;
  const odd: string[] = [];
  let last: HistoryEntry | undefined;
  for (const line of section("Trials")) {
    const marker = /^### v(\d+)\s*$/.exec(line.trim());
    if (marker) {
      version = Number(marker[1]);
      last = undefined;
      continue;
    }
    const m = TRIAL_LINE.exec(line.trim());
    if (m) {
      last = {
        date: m[1] ?? "",
        event: "trial",
        version,
        good: m[2] === "✓",
        fields: cleanFields({ harness: m[3], note: m[4] }),
      };
      trials.push(last);
    } else if (line.trim() && last) last.text = [last.text, line.trim()].filter(Boolean).join("\n"); // a trial note's next line
    else if (line.trim()) odd.push(line);
  }
  keep("Trials", odd);

  // A move before the item was laid belongs to an earlier item with the same id (cracked, deleted, laid again).
  const moved: HistoryEntry[] = moves
    .filter((mv) => mv.id === egg.id && mv.date >= laid.date)
    .map((mv) => {
      const v = versionOn(mv.date);
      const counts = trials.filter((t) => t.version === v && t.date <= mv.date);
      const good = counts.filter((t) => t.good).length;
      return {
        date: mv.date,
        event: mv.event,
        version: v,
        fields: { trials: `✓${good} ✗${counts.length - good} (v${v})`, note: "recovered from the basket's git log" },
      };
    });

  if (leftovers.length) laid.text = leftovers.join("\n");
  return sortHistory([laid, ...imports, ...evolved, ...trials, ...moved]);
}

/**
 * Chronological order. Dates are days, so same-day events order by what they mean: a
 * lay first, then trials of v1, the evolve to v2, trials of v2, and so on; a hatch or
 * crack after the trials of its version, then a rename; an import before its version's trials.
 */
export function sortHistory(entries: HistoryEntry[]): HistoryEntry[] {
  const rank = (e: HistoryEntry): number => {
    switch (e.event) {
      case "laid":
        return 0;
      case "imported":
        return 2 * e.version - 0.5;
      case "evolved":
        return 2 * e.version - 1;
      case "trial":
        return 2 * e.version;
      case "renamed":
        return 2 * e.version + 0.75;
      default:
        return 2 * e.version + 0.5;
    }
  };
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.date.localeCompare(b.e.date) || rank(a.e) - rank(b.e) || a.i - b.i)
    .map(({ e }) => e);
}

/**
 * Hatches and cracks from the basket's commit log (`<date>\t<subject>` lines, any order
 * git prints them; newest first is fine), with each id followed through later renames
 * so a move made under an item's old id lands on its current one.
 */
export function movesFromLog(log: string): LoggedMove[] {
  const commits = log
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((parts): parts is [string, string] => parts.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0] ?? ""))
    .reverse();
  const moves: LoggedMove[] = [];
  for (const [date, subject] of commits) {
    const hatch = /^chicken: hatch (\S+)$/.exec(subject);
    const crack = /^crack: (\S+)$/.exec(subject);
    const rename = /^\w+: rename (\S+) to (\S+)$/.exec(subject);
    if (hatch) moves.push({ id: hatch[1] ?? "", event: "hatched", date });
    else if (crack) moves.push({ id: crack[1] ?? "", event: "cracked", date });
    // A rename carries only the moves made before it: a later item laid under the old id keeps its own.
    else if (rename) for (const m of moves) if (m.id === rename[1]) m.id = rename[2] ?? m.id;
  }
  return moves;
}

/**
 * Entries from legacy sections merged into an existing log (an older deveggs wrote to a
 * migrated item): one lay only, the logged one, keeping any leftover text of the other.
 */
export function mergeHistory(fromLegacy: HistoryEntry[], logged: HistoryEntry[]): HistoryEntry[] {
  const lay = logged.find((e) => e.event === "laid");
  if (!lay) return sortHistory([...fromLegacy, ...logged]);
  const built = fromLegacy.find((e) => e.event === "laid");
  const merged = built?.text ? { ...lay, text: [lay.text, built.text].filter(Boolean).join("\n") } : lay;
  return sortHistory([...fromLegacy.filter((e) => e !== built), ...logged.map((e) => (e === lay ? merged : e))]);
}
