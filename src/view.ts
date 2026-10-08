import { type Egg, isReady, READY_AFTER, type Tier } from "./basket.ts";
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

const trials = (egg: Egg): string => (egg.tier === "egg" ? `✓${egg.good} ✗${egg.bad}` : "");

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
  for (const line of body.slice(at).split("\n")) {
    const m = TRIAL.exec(line.trim());
    if (m) trials.push({ date: m[1] ?? "", good: m[2] === "✓", harness: m[3] ?? "", note: m[4] ?? "" });
  }
  return { prose: body.slice(0, at).trim(), trials };
}

const TIER_LABEL: Record<Tier, string> = { egg: "egg (on trial)", chicken: "chicken (permanent)", cracked: "cracked (rejected)" };

/** One item in full: metadata as key/value rows, its notes and origin, then the trial log as a table. */
export function formatShow(egg: Egg, options: ViewOptions): string {
  const p = palette(options.color);
  const { prose, trials: log } = splitTrials(egg.body);
  const trialCell: Cell =
    egg.tier === "egg"
      ? {
          text: `${trials(egg)}${isReady(egg) ? `  🐣 ready to hatch: deveggs hatch ${egg.id}` : `  (${READY_AFTER} ✓ and no ✗ to hatch)`}`,
          paint: (s) => paintTrials(p)(isReady(egg) ? s.replace(/🐣.*/, (m) => p.yellow(m)) : s.replace(/\(.*\)/, (m) => p.dim(m))),
        }
      : { text: `✓${egg.good} ✗${egg.bad}`, paint: paintTrials(p) };
  const out = [
    `${mark(egg)} ${p.bold(egg.id)}`,
    "",
    ...keyValues(
      [
        ["fact", egg.summary],
        ["tier", TIER_LABEL[egg.tier]],
        ["kind", egg.kind],
        ["tags", egg.tags.join(", ") || "-"],
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
    out.push(
      ...table(
        [{ header: "date" }, { header: "harness", max: 16 }, { header: "✓/✗" }, { header: "note", flex: true, min: 20 }],
        log.map((t): Cell[] => [
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
