import { type Egg, isReady, parseEvolution, READY_AFTER, type Tier } from "./basket.ts";
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
 * the log), then the current one (from the frontmatter, which is what hatching counts).
 * "✓2 ✗1 (v1) · ✓0 ✗0 (v2)"; just "✓1 ✗0" for an item that never evolved.
 */
export function trialCounts(egg: Egg): string {
  if (egg.version <= 1) return `✓${egg.good} ✗${egg.bad}`;
  const earlier = new Map<number, { good: number; bad: number }>();
  for (const t of splitTrials(egg.body).trials) {
    if (t.version >= egg.version) continue;
    const n = earlier.get(t.version) ?? { good: 0, bad: 0 };
    if (t.good) n.good++;
    else n.bad++;
    earlier.set(t.version, n);
  }
  const counts = [...earlier].sort(([a], [b]) => a - b).map(([v, n]) => `✓${n.good} ✗${n.bad} (v${v})`);
  return [...counts, `✓${egg.good} ✗${egg.bad} (v${egg.version})`].join(" · ");
}

const trials = (egg: Egg): string => (egg.tier === "egg" ? trialCounts(egg) : egg.version > 1 ? `v${egg.version}` : "");

/** Basket overview: one aligned row per item, chickens, then eggs, then ready eggs, then cracked. */
export function formatList(eggs: Egg[], options: ViewOptions): string {
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
      { text: trials(egg), paint: paintTrials(p) },
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

export interface Trial {
  /** The version of the fact it was judged under: 1 until a `### vN` marker in the log. */
  version: number;
  date: string;
  good: boolean;
  harness: string;
  note: string;
}

const TRIAL = /^- (\S+) ([✓✗])(?: \(([^)]*)\))?(?: (.*))?$/;

/** Split an egg's body into its prose (notes, origin) and its parsed trial log. */
export function splitTrials(body: string): { prose: string; trials: Trial[] } {
  const at = body.search(/^## Trials$/m);
  if (at < 0) return { prose: body, trials: [] };
  const trials: Trial[] = [];
  let version = 1;
  for (const line of body.slice(at).split("\n")) {
    const marker = /^### v(\d+)\s*$/.exec(line.trim());
    if (marker) version = Number(marker[1]);
    const m = TRIAL.exec(line.trim());
    if (m) trials.push({ version, date: m[1] ?? "", good: m[2] === "✓", harness: m[3] ?? "", note: m[4] ?? "" });
  }
  return { prose: body.slice(0, at).trim(), trials };
}

const TIER_LABEL: Record<Tier, string> = { egg: "egg (on trial)", chicken: "chicken (permanent)", cracked: "cracked (rejected)" };

/** One item in full: metadata as key/value rows, its notes and origin, then the trial log as a table. */
export function formatShow(egg: Egg, options: ViewOptions): string {
  const p = palette(options.color);
  const { prose, trials: log } = splitTrials(egg.body);
  const since = egg.version > 1 ? ` since v${egg.version}` : "";
  const hint = isReady(egg) ? `🐣 ready to hatch: deveggs hatch ${egg.id}` : `(${READY_AFTER} ✓ and no ✗${since} to hatch)`;
  const counts = trialCounts(egg);
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
  const latest = parseEvolution(egg.body).filter((e) => !e.renamedFrom).at(-1);
  const versionRow: Array<[string, string]> = egg.version > 1 ? [["version", `v${egg.version}${latest ? ` (evolved ${latest.date})` : ""}`]] : [];
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
          { text: t.harness || "-", paint: p.dim },
          { text: t.good ? "✓" : "✗", paint: t.good ? p.green : p.red },
          { text: t.note },
        ]),
        { width: options.width, palette: p },
      ),
    );
  }
  return out.join("\n");
}
