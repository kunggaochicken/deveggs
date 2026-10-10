import { type Egg, isReady, READY_AFTER, type Tier } from "./basket.ts";
import { type HistoryEntry, trialsByVersion } from "./history.ts";
import { type Cell, type Column, displayWidth, keyValues, palette, paintTrials, type Palette, table, truncate } from "./table.ts";

export interface ViewOptions {
  /** Line width in terminal cells. */
  width: number;
  /** Emit ANSI color. */
  color: boolean;
}

/** Fallback width when neither the terminal nor $COLUMNS gives one (pipes, agents). */
export const DEFAULT_WIDTH = 100;

export function terminalOptions(stream: { isTTY?: boolean; columns?: number } = process.stdout, env: NodeJS.ProcessEnv = process.env): ViewOptions {
  const fromEnv = Number(env["COLUMNS"]);
  return {
    width: stream.columns && stream.columns > 0 ? stream.columns : fromEnv > 0 ? fromEnv : DEFAULT_WIDTH,
    color: stream.isTTY === true && !env["NO_COLOR"],
  };
}

type Group = "chicken" | "ready" | "egg" | "cracked";
const GROUP_ORDER: Group[] = ["chicken", "egg", "ready", "cracked"];

const group = (egg: Egg): Group => (isReady(egg) ? "ready" : egg.tier);

export function mark(egg: Egg): string {
  return ({ chicken: "🐔", ready: "🐣", egg: "🥚", cracked: "💥" } as const)[group(egg)];
}

/**
 * Trial counts per version, oldest first: earlier versions that had trials (counted from
 * the history), then the current one (from the frontmatter, which is what hatching counts).
 * "✓2 ✗1 (v1) · ✓0 ✗0 (v2)"; just "✓1 ✗0" for an item that never evolved.
 */
export function trialCounts(egg: Egg, history: HistoryEntry[] = []): string {
  if (egg.version <= 1) return `✓${egg.good} ✗${egg.bad}`;
  const counts = [...trialsByVersion(history)].filter(([v]) => v < egg.version).map(([v, n]) => `✓${n.good} ✗${n.bad} (v${v})`);
  return [...counts, `✓${egg.good} ✗${egg.bad} (v${egg.version})`].join(" · ");
}

const trials = (egg: Egg, history: HistoryEntry[] = []): string =>
  egg.tier === "egg" ? trialCounts(egg, history) : egg.version > 1 ? `v${egg.version}` : "";

/** Basket overview: one aligned row per item, chickens, then eggs, then ready eggs, then cracked. */
export function formatList(eggs: Egg[], options: ViewOptions, histories: Map<string, HistoryEntry[]> = new Map()): string {
  if (!eggs.length) return "basket is empty";
  const p = palette(options.color);
  const sorted = [...eggs].sort((a, b) => GROUP_ORDER.indexOf(group(a)) - GROUP_ORDER.indexOf(group(b)));
  const facts: Cell[] = [];
  const rows = sorted.map((egg): Cell[] => {
    const g = group(egg);
    const fade = g === "cracked" ? p.dim : undefined;
    const id = g === "ready" ? p.yellow : g === "chicken" ? p.bold : fade;
    facts.push({ text: egg.summary, ...(fade && { paint: fade }) });
    return [
      { text: mark(egg) },
      { text: egg.id, ...(id && { paint: id }) },
      { text: egg.kind, paint: p.dim },
      { text: egg.tags.join(", "), paint: p.dim },
      { text: trials(egg, histories.get(egg.id)), paint: paintTrials(p) },
    ];
  });
  const meta: Column[] = [{ header: "" }, { header: "id" }, { header: "kind" }, { header: "tags", max: 20 }, { header: "trials" }];
  const tableOptions = { width: options.width, palette: p };
  const metaLines = table(meta, rows, tableOptions);
  const metaWidth = Math.max(...metaLines.map(displayWidth));
  let lines: string[];
  if (options.width - metaWidth - 2 >= MIN_FACT) {
    lines = table([...meta, { header: "fact", flex: true, min: MIN_FACT }], rows.map((row, i) => [...row, facts[i] ?? ""]), tableOptions);
  } else {
    // Too narrow for the fact beside long ids: put each fact on its own line under its row.
    const indent = "    ";
    lines = metaLines.flatMap((line, i) => {
      const fact = facts[i - 1];
      if (!fact) return [line];
      return [line, `${indent}${(fact.paint ?? ((t: string) => t))(truncate(fact.text, options.width - indent.length))}`];
    });
  }
  return [...lines, "", summaryLine(eggs, p)].join("\n");
}

/** Narrowest fact column worth printing beside the other columns. */
const MIN_FACT = 30;

function summaryLine(eggs: Egg[], p: Palette): string {
  const count = (g: Group): number => eggs.filter((e) => group(e) === g).length;
  const n = (k: number, noun: string): string => `${k} ${noun}${k === 1 ? "" : "s"}`;
  const parts = [`🐔 ${n(count("chicken"), "chicken")}`, `🥚 ${n(count("egg") + count("ready"), "egg")}`];
  if (count("ready")) parts.push(p.yellow(`🐣 ${count("ready")} ready to hatch`));
  if (count("cracked")) parts.push(`💥 ${count("cracked")} cracked`);
  return parts.join("  ·  ");
}

const TIER_LABEL: Record<Tier, string> = { egg: "egg (on trial)", chicken: "chicken (permanent)", cracked: "cracked (rejected)" };

/** One item in full: metadata as key/value rows, its origin and notes, then the trial log as a table. */
export function formatShow(egg: Egg, options: ViewOptions, history: HistoryEntry[] = []): string {
  const p = palette(options.color);
  const prose = egg.body;
  const log = history.filter((e) => e.event === "trial");
  const since = egg.version > 1 ? ` since v${egg.version}` : "";
  const hint = isReady(egg) ? `🐣 ready to hatch: deveggs hatch ${egg.id}` : `(${READY_AFTER} ✓ and no ✗${since} to hatch)`;
  const counts = trialCounts(egg, history);
  const trialCell: Cell =
    egg.tier === "egg"
      ? {
          text: `${counts}  ${hint}`,
          paint: (s) => {
            const at = s.lastIndexOf(hint);
            if (at < 0) return paintTrials(p)(s);
            return paintTrials(p)(s.slice(0, at)) + (isReady(egg) ? p.yellow : p.dim)(s.slice(at));
          },
        }
      : { text: counts, paint: paintTrials(p) };
  const latest = history.filter((e) => e.event === "evolved").at(-1);
  const laid = history.find((e) => e.event === "laid" || e.event === "imported");
  const where = laid ? [laid.date, laid.fields["harness"], laid.fields["repo"], laid.event === "imported" && `borrowed from ${laid.fields["from"]}`].filter(Boolean).join(" · ") : "";
  const originRows: Array<[string, string]> = [
    ...(laid?.quote ? [["origin", `"${laid.quote.replace(/\s*\n\s*/g, " ")}"`] as [string, string]] : []),
    ...(where ? [[laid?.quote ? "" : "origin", where] as [string, string]] : []),
  ];
  const renamed = history.filter((e) => e.event === "renamed").at(-1);
  const versionRow: Array<[string, string]> = [
    ...(egg.version > 1 ? [["version", `v${egg.version}${latest ? ` (evolved ${latest.date})` : ""}`] as [string, string]] : []),
    ...(latest?.fields["was"] ? [[`was (v${latest.version - 1})`, latest.fields["was"]] as [string, string]] : []),
    ...(renamed?.fields["from"] ? [["renamed from", `${renamed.fields["from"]} (${renamed.date})`] as [string, string]] : []),
  ];
  const out = [
    `${mark(egg)} ${p.bold(egg.id)}`,
    "",
    ...keyValues(
      [
        ["fact", egg.summary],
        ["tier", TIER_LABEL[egg.tier]],
        ["kind", egg.kind],
        ["tags", egg.tags.join(", ") || "-"],
        ...versionRow,
        ["trials", trialCell],
        ["harnesses", egg.harnesses.join(", ") || "-"],
        ["laid", egg.laid],
        ["updated", egg.updated],
        ...originRows,
      ],
      p,
    ),
  ];
  if (prose) out.push("", prose);
  if (log.length) {
    out.push("", p.bold("## Trials"), "");
    // Once the fact has evolved, a v column says which version each trial judged.
    const versioned = egg.version > 1;
    out.push(
      ...table(
        [...(versioned ? [{ header: "v" }] : []), { header: "date" }, { header: "harness", max: 16 }, { header: "✓/✗" }, { header: "note", flex: true, min: 20 }],
        log.map((t): Cell[] => [
          ...(versioned ? [{ text: `v${t.version}`, ...(t.version < egg.version && { paint: p.dim }) }] : []),
          { text: t.date },
          { text: t.fields["harness"] || "-", paint: p.dim },
          { text: t.good ? "✓" : "✗", paint: t.good ? p.green : p.red },
          { text: verdict(t) },
        ]),
        { width: options.width, palette: p },
      ),
    );
  }
  if (history.length) out.push("", p.dim(`how it got here: deveggs history ${egg.id}`));
  return out.join("\n");
}

/** A trial's note, then the verdict fields that explain it, on one line. */
function verdict(t: HistoryEntry): string {
  const f = t.fields;
  return [f["note"] ?? f["result"], f["cause"] && `cause: ${f["cause"]}`, f["tuning"] && `tuning: ${f["tuning"]}`].filter(Boolean).join(" · ");
}

// --- history ---------------------------------------------------------------------

const ICON: Record<HistoryEntry["event"], string> = {
  laid: "🥚",
  trial: "",
  evolved: "🧬",
  hatched: "🐣",
  cracked: "💥",
  renamed: "🏷️",
  imported: "📥",
};

/** Word-wrap `text` to `width` cells; every line after the first gets `indent`. */
function wrap(text: string, width: number, indent: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && displayWidth(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i ? indent + l : l));
}

/** What an entry's heading says: "🥚 laid v1", "✗ trial v2", "🧬 evolved v1 → v2". */
function headline(e: HistoryEntry): string {
  if (e.event === "trial") return `${e.good ? "✓" : "✗"} trial v${e.version}`;
  if (e.event === "evolved") return `${ICON.evolved} evolved v${e.version - 1} → v${e.version}`;
  if (e.event === "laid" && e.fields["tier"] === "chicken") return `🐔 laid v1 as a chicken`;
  if (e.event === "renamed") return `${ICON.renamed} renamed ${e.fields["from"] ?? "?"} → ${e.fields["to"] ?? "?"}`;
  if (e.event === "imported") return `${ICON.imported} imported v${e.version} from ${e.fields["from"] ?? "?"}`;
  return `${ICON[e.event]} ${e.event} v${e.version}`;
}

/** Fields already in the headline or the context line, so not repeated below it. */
const SHOWN = new Set(["harness", "repo", "session", "from", "to", "tier"]);

/**
 * `deveggs history <id>`: the item's story as a readable timeline, oldest first. Each
 * entry is a date and headline with its context (harness · repo · session), then the
 * developer's words and the fields that explain it (scenario, result, cause, tuning,
 * was/now/why…), wrapped to the terminal.
 */
export function formatTimeline(egg: Egg, entries: HistoryEntry[], options: ViewOptions, filtered = false): string {
  const p = palette(options.color);
  const pad = " ".repeat(12);
  const counts = [...trialsByVersion(entries)];
  const good = counts.reduce((n, [, c]) => n + c.good, 0);
  const bad = counts.reduce((n, [, c]) => n + c.bad, 0);
  const out = [
    `${mark(egg)} ${p.bold(egg.id)}  ${p.dim(`${TIER_LABEL[egg.tier]} · v${egg.version} · ${entries.length} ${filtered ? "matching " : ""}event${entries.length === 1 ? "" : "s"}`)}`,
    `   ${egg.summary}`,
  ];
  if (!entries.length) return [...out, "", filtered ? "nothing matches" : "no history yet"].join("\n");
  for (const e of entries) {
    const head = headline(e);
    const paint = e.event === "trial" ? (e.good ? p.green : p.red) : e.event === "evolved" || e.event === "hatched" ? p.yellow : p.bold;
    const where = [e.fields["harness"], e.fields["repo"], e.fields["session"] && `session ${e.fields["session"]}`].filter(Boolean).join(" · ");
    out.push("", `${e.date}  ${paint(head)}${where ? `  ${p.dim(where)}` : ""}`);
    const room = Math.max(30, options.width - pad.length);
    if (e.quote) out.push(...wrap(`"${e.quote.replace(/\s*\n\s*/g, " ")}"`, room, pad).map((l, i) => (i ? l : pad + l)));
    const keys = Object.keys(e.fields).filter((k) => !SHOWN.has(k));
    const keyWidth = Math.max(0, ...keys.map((k) => k.length));
    for (const key of keys) {
      const label = `${key.padEnd(keyWidth)}  `;
      const indent = pad + " ".repeat(label.length);
      out.push(pad + p.dim(label) + wrap(e.fields[key] ?? "", Math.max(20, room - label.length), indent).join("\n"));
    }
    if (e.text) out.push(...e.text.split("\n").map((l) => pad + p.dim(l)));
  }
  const evolves = entries.filter((e) => e.event === "evolved").length;
  const summary = [counts.length ? `✓${good} ✗${bad} across ${counts.length} version${counts.length === 1 ? "" : "s"}` : "no trials", `${evolves} evolve${evolves === 1 ? "" : "s"}`];
  const hatched = entries.find((e) => e.event === "hatched");
  if (hatched) summary.push(`hatched ${hatched.date}`);
  out.push("", p.dim(summary.join("  ·  ")));
  return out.join("\n");
}
