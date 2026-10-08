/**
 * Plain-text tables for the terminal. Widths count wide emoji as two cells, so
 * columns line up, and ANSI color is applied only after padding and truncation.
 */

/** Ranges (inclusive) of code points a terminal draws two cells wide. */
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a],
  [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];

function charWidth(cp: number): number {
  // Zero width: combining marks, zero-width space/joiners, variation selectors.
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (cp < 0x1100) return 1;
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi) ? 2 : 1;
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** Terminal cells a string occupies, ignoring ANSI escapes. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text.replace(ANSI, "")) width += charWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/** Cut plain text to at most `max` cells, ending in "…" when anything was dropped. */
export function truncate(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  if (max <= 0) return "";
  let out = "";
  let width = 0;
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0);
    if (width + w > max - 1) break;
    out += ch;
    width += w;
  }
  return `${out.trimEnd()}…`;
}

const pad = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - displayWidth(text)));

// --- color ----------------------------------------------------------------------

export type Paint = (text: string) => string;

export interface Palette {
  bold: Paint;
  dim: Paint;
  green: Paint;
  red: Paint;
  yellow: Paint;
}

const sgr = (open: number, close: number): Paint => (text) => (text ? `\x1b[${open}m${text}\x1b[${close}m` : text);
const plain: Paint = (text) => text;

export function palette(color: boolean): Palette {
  if (!color) return { bold: plain, dim: plain, green: plain, red: plain, yellow: plain };
  return { bold: sgr(1, 22), dim: sgr(2, 22), green: sgr(32, 39), red: sgr(31, 39), yellow: sgr(33, 39) };
}

/** Color ✓n green and ✗n red inside a trial count like "✓3 ✗0". */
export function paintTrials(p: Palette): Paint {
  return (text) => text.replace(/✓\d*/g, (m) => p.green(m)).replace(/✗\d*/g, (m) => p.red(m));
}

// --- tables ---------------------------------------------------------------------

export interface Column {
  header: string;
  /** Hard cap on this column's width; longer cells are truncated with "…". */
  max?: number;
  /** Takes whatever width is left on the line (at least `min`). One per table. */
  flex?: boolean;
  min?: number;
}

export interface Cell {
  text: string;
  paint?: Paint;
}

export interface TableOptions {
  /** Total line width to fit, in terminal cells. */
  width: number;
  palette: Palette;
  /** Gap between columns. */
  gap?: number;
  /** Print the header row. */
  header?: boolean;
}

/**
 * Lay rows out as aligned columns. Cells are measured and truncated as plain text,
 * then painted, so color never throws off the alignment. The last column is not padded.
 */
export function table(columns: Column[], rows: Array<Array<string | Cell>>, options: TableOptions): string[] {
  const gap = " ".repeat(options.gap ?? 2);
  const showHeader = options.header ?? true;
  const cells = rows.map((row) => columns.map((_, i) => {
    const cell = row[i] ?? "";
    return typeof cell === "string" ? { text: cell } : cell;
  }));
  const widths = columns.map((col, i) => {
    const natural = Math.max(showHeader ? displayWidth(col.header) : 0, ...cells.map((r) => displayWidth(r[i]?.text ?? "")));
    return col.max !== undefined ? Math.min(natural, col.max) : natural;
  });
  const flex = columns.findIndex((c) => c.flex);
  if (flex >= 0) {
    const fixed = widths.reduce((sum, w, i) => (i === flex ? sum : sum + w), 0) + gap.length * (columns.length - 1);
    const natural = widths[flex] ?? 0;
    widths[flex] = Math.min(natural, Math.max(columns[flex]?.min ?? 10, options.width - fixed));
  }
  const line = (row: Cell[], paintAll?: Paint): string =>
    row
      .map((cell, i) => {
        const width = widths[i] ?? 0;
        const text = truncate(cell.text, width);
        const painted = (paintAll ?? cell.paint ?? plain)(text);
        return i === row.length - 1 ? painted : painted + " ".repeat(Math.max(0, width - displayWidth(text)));
      })
      .join(gap)
      .trimEnd();
  const out = cells.map((row) => line(row));
  if (showHeader) out.unshift(line(columns.map((c) => ({ text: c.header })), options.palette.dim));
  return out;
}

/** A two-column key/value table, keys padded to line up. */
export function keyValues(pairs: Array<[string, string | Cell]>, p: Palette, indent = "  "): string[] {
  const keyWidth = Math.max(0, ...pairs.map(([k]) => displayWidth(k)));
  return pairs.map(([key, value]) => {
    const cell = typeof value === "string" ? { text: value } : value;
    return `${indent}${p.dim(pad(key, keyWidth))}  ${(cell.paint ?? plain)(cell.text)}`.trimEnd();
  });
}

// --- markdown -------------------------------------------------------------------

/** Escape a value for a Markdown table cell. */
export function mdCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const row = (cells: string[]): string => `| ${cells.map(mdCell).join(" | ")} |`;
  return [row(headers), `|${headers.map(() => "---").join("|")}|`, ...rows.map(row)].join("\n");
}
