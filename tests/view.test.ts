import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Basket, READY_AFTER } from "../src/basket.ts";
import { displayWidth, markdownTable, table, palette, truncate } from "../src/table.ts";
import { DEFAULT_WIDTH, formatList, formatShow, formatTimeline, terminalOptions, trialCounts } from "../src/view.ts";

const ESC = "\x1b[";
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** A temp basket with a chicken, a plain egg, an egg with mixed trials, a ready egg and a cracked one. */
function seeded(): { home: string; basket: Basket } {
  const home = mkdtempSync(join(tmpdir(), "deveggs-view-"));
  const b = new Basket(join(home, "basket"));
  b.lay({ summary: "Never push to main", chicken: true, tags: ["git"] });
  b.lay({ summary: "Post before and after screenshots for UI changes", tags: ["pull-requests"] });
  b.lay({ summary: "Draw a diagram for complex explanations", tags: ["explaining"], harness: "claude", origin: { quote: "draw it", repo: "grover" }, today: "2026-10-05" });
  b.feedback("draw-a-diagram-for-complex-explanations", { good: true, harness: "codex", note: "clarified the flow", today: "2026-10-06" });
  b.feedback("draw-a-diagram-for-complex-explanations", { good: false, harness: "claude", note: "overkill", today: "2026-10-07" });
  b.lay({ summary: "End each turn with a one-line summary", tags: ["comms"] });
  for (let i = 0; i < READY_AFTER; i++) b.feedback("end-each-turn-with-a-one-line-summary", { good: true });
  b.lay({ summary: "Use tabs", tags: ["style"] });
  b.crack("use-tabs");
  return { home, basket: b };
}

test("displayWidth counts wide emoji as two cells and ignores ANSI", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("🥚"), 2);
  assert.equal(displayWidth("🐔🐣💥"), 6);
  assert.equal(displayWidth("✓3 ✗0"), 5);
  assert.equal(displayWidth(`${ESC}32m✓3${ESC}39m`), 2);
});

test("truncate cuts to the width and ends with an ellipsis", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("abcdefghij", 6), "abcde…");
  assert.equal(displayWidth(truncate("🥚🥚🥚🥚", 5)), 5);
  assert.equal(truncate("word  word", 6), "word…");
});

test("table pads emoji cells so later columns line up", () => {
  const lines = table([{ header: "" }, { header: "id" }], [["🥚", "a"], ["x", "b"]], { width: 80, palette: palette(false) });
  assert.deepEqual(lines, ["    id", "🥚  a", "x   b"]);
});

test("list groups chickens, then eggs, then ready, then cracked, aligned with no color", () => {
  const { basket } = seeded();
  const out = formatList(basket.all(), { width: 160, color: false });
  assert.ok(!out.includes(ESC), "plain output has no ANSI escapes");
  const rows = out.split("\n");
  const marks = rows.slice(1, 6).map((r) => r.slice(0, 2));
  assert.deepEqual(marks, ["🐔", "🥚", "🥚", "🐣", "💥"]);
  const header = rows[0] ?? "";
  assert.match(header, /^ {4}id +kind +tags +trials +fact$/);
  // Every row's fact starts in the same terminal column as the header's.
  const factAt = displayWidth(header.slice(0, header.indexOf("fact")));
  for (const [i, fact] of ["Never push", "Draw a diagram", "Post before", "End each turn", "Use tabs"].entries()) {
    const row = rows[i + 1] ?? "";
    assert.equal(displayWidth(row.slice(0, row.indexOf(fact))), factAt, row);
  }
  assert.match(out, /✓1 ✗1/);
  assert.match(rows.at(-1) ?? "", /🐔 1 chicken  ·  🥚 3 eggs  ·  🐣 1 ready to hatch  ·  💥 1 cracked/);
});

test("list colors trials and ready eggs only when asked", () => {
  const { basket } = seeded();
  const out = formatList(basket.all(), { width: 160, color: true });
  assert.ok(out.includes(`${ESC}32m✓1${ESC}39m ${ESC}31m✗1${ESC}39m`));
  assert.ok(out.includes(`${ESC}33mend-each-turn-with-a-one-line-summary${ESC}39m`));
  assert.equal(strip(out), formatList(basket.all(), { width: 160, color: false }));
});

test("list truncates facts to the terminal width", () => {
  const { basket } = seeded();
  const lines = formatList(basket.all(), { width: 120, color: false }).split("\n");
  for (const line of lines) assert.ok(displayWidth(line) <= 120, `fits: ${line}`);
  assert.match(lines[0] ?? "", /fact$/);
  assert.ok(lines.some((l) => l.endsWith("…")));
  assert.ok(lines.some((l) => l.endsWith("Never push to main")), "short facts are not cut");
});

test("list stacks facts under their rows when ids leave no room beside them", () => {
  const { basket } = seeded();
  const lines = formatList(basket.all(), { width: 90, color: false }).split("\n");
  assert.doesNotMatch(lines[0] ?? "", /fact/);
  assert.equal(lines[1]?.slice(0, 2), "🐔");
  assert.equal(lines[2], "    Never push to main");
  assert.match(lines[4] ?? "", /^ {4}Draw a diagram/);
  for (const line of lines) assert.ok(displayWidth(line) <= 90, `fits: ${line}`);
  // Ids are handles, so they are never cut, even when the line is narrower than they are.
  assert.match(formatList(basket.all(), { width: 30, color: false }), /post-before-and-after-screenshots-for-ui-changes/);
});

test("terminal options: color needs a TTY and no NO_COLOR; width falls back to 100", () => {
  assert.deepEqual(terminalOptions({ isTTY: true, columns: 120 }, {}), { width: 120, color: true });
  assert.deepEqual(terminalOptions({ isTTY: true, columns: 120 }, { NO_COLOR: "1" }), { width: 120, color: false });
  assert.deepEqual(terminalOptions({}, {}), { width: DEFAULT_WIDTH, color: false });
  assert.deepEqual(terminalOptions({}, { COLUMNS: "132" }), { width: 132, color: false });
});

test("show renders metadata as key/values and the trial log as a table", () => {
  const { basket } = seeded();
  const id = "draw-a-diagram-for-complex-explanations";
  const out = formatShow(basket.get(id), { width: 100, color: false }, basket.history(id));
  assert.match(out, /^🥚 draw-a-diagram-for-complex-explanations\n/);
  assert.match(out, /\n {2}tier {7}egg \(on trial\)\n/);
  assert.match(out, /\n {2}trials {5}✓1 ✗1 {2}\(3 ✓ and no ✗ to hatch\)\n/);
  assert.match(out, /\n {2}origin {5}"draw it"\n {13}2026-10-05 · claude · grover\n/);
  assert.match(out, /date {8}harness {2}✓\/✗ {2}note\n2026-10-06 {2}codex {4}✓ {4}clarified the flow\n2026-10-07 {2}claude {3}✗ {4}overkill\n\nhow it got here: deveggs history draw-a-diagram-for-complex-explanations$/);
  const ready = formatShow(basket.get("end-each-turn-with-a-one-line-summary"), { width: 100, color: false });
  assert.match(ready, /🐣 ready to hatch: deveggs hatch end-each-turn-with-a-one-line-summary/);
});

test("after an evolve, list and show split trials by version", () => {
  const home = mkdtempSync(join(tmpdir(), "deveggs-view-"));
  const b = new Basket(join(home, "basket"));
  b.lay({ id: "terse", summary: "One-line summaries" });
  b.feedback("terse", { good: true, harness: "claude", today: "2026-10-06" });
  b.feedback("terse", { good: false, harness: "codex", today: "2026-10-07" });
  b.evolve("terse", { summary: "One-line summaries, except for decisions", quote: "give me options", note: "narrow", today: "2026-10-08" });
  const egg = b.feedback("terse", { good: true, harness: "claude", note: "table helped", today: "2026-10-09" });
  const history = b.history("terse");
  assert.equal(trialCounts(egg, history), "✓1 ✗1 (v1) · ✓1 ✗0 (v2)");
  assert.equal(trialCounts(egg), "✓1 ✗0 (v2)", "without its history, only the current version's counts");
  assert.match(formatList(b.all(), { width: 160, color: false }, new Map([["terse", history]])), /🥚 {2}terse .* ✓1 ✗1 \(v1\) · ✓1 ✗0 \(v2\) {2}One-line summaries, except/);
  const out = formatShow(egg, { width: 100, color: false }, history);
  assert.match(out, /\n {2}version {4}v2 \(evolved 2026-10-08\)\n/);
  assert.match(out, /\n {2}trials {5}✓1 ✗1 \(v1\) · ✓1 ✗0 \(v2\) {2}\(3 ✓ and no ✗ since v2 to hatch\)\n/);
  assert.match(out, /\n {2}was \(v1\) {3}One-line summaries\n/);
  assert.match(out, /v {3}date {8}harness {2}✓\/✗ {2}note\nv1 {2}2026-10-06 {2}claude {3}✓\nv1 {2}2026-10-07 {2}codex {4}✗\nv2 {2}2026-10-09 {2}claude {3}✓ {4}table helped\n\nhow it got here: deveggs history terse$/);
  // A chicken that evolved shows its version in the list, not trial counts.
  b.lay({ id: "no-push", summary: "Never push to main", chicken: true });
  b.evolve("no-push", { summary: "Never push to main or release branches" });
  assert.match(formatList(b.all(), { width: 160, color: false }), /🐔 {2}no-push .* v2 {2,}Never push to main or release/);
});

test("markdownTable escapes pipes and newlines", () => {
  assert.equal(markdownTable(["a", "b"], [["x|y", "1\n2"]]), "| a | b |\n|---|---|\n| x\\|y | 1 2 |");
});

test("the CLI prints plain text when piped, even with color allowed", () => {
  const { home } = seeded();
  const cli = join(import.meta.dirname, "..", "src", "cli.ts");
  const env: NodeJS.ProcessEnv = { ...process.env, DEVEGGS_BASKET: join(home, "basket"), COLUMNS: "" };
  delete env["NO_COLOR"];
  const out = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "list"], { env, encoding: "utf8" });
  assert.ok(!out.includes(ESC));
  for (const line of out.trimEnd().split("\n")) assert.ok(displayWidth(line) <= DEFAULT_WIDTH, `fits: ${line}`);
  const ready = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "list", "--tier", "ready"], { env, encoding: "utf8" });
  assert.match(ready, /🐣 {2}end-each-turn-with-a-one-line-summary/);
  assert.doesNotMatch(ready, /🐔 {2}/);
});

test("the history timeline tells the story oldest first, with every verdict field", () => {
  const home = mkdtempSync(join(tmpdir(), "deveggs-view-"));
  const b = new Basket(join(home, "basket"));
  b.lay({ id: "terse", summary: "One-line summaries", harness: "claude", origin: { quote: "one line please", repo: "grover", session: "s1" }, today: "2026-10-06" });
  b.feedback("terse", { good: false, harness: "codex", scenario: "design review", result: "lost the trade-offs", cause: "too broad", tuning: "narrow: decisions", today: "2026-10-07" });
  b.evolve("terse", { summary: "One-line summaries, except decisions", quote: "give me options", note: "narrow: decisions", harness: "claude", today: "2026-10-08" });
  for (let i = 0; i < READY_AFTER; i++) b.feedback("terse", { good: true, today: "2026-10-09" });
  b.hatch("terse", { today: "2026-10-10", quote: "hatch it" });
  const out = formatTimeline(b.get("terse"), b.history("terse"), { width: 100, color: false });
  assert.equal(
    out.split("\n").slice(0, 21).join("\n"),
    [
      "🐔 terse  chicken (permanent) · v2 · 7 events",
      "   One-line summaries, except decisions",
      "",
      "2026-10-06  🥚 laid v1  claude · grover · session s1",
      "            \"one line please\"",
      "            fact  One-line summaries",
      "",
      "2026-10-07  ✗ trial v1  codex",
      "            scenario  design review",
      "            result    lost the trade-offs",
      "            cause     too broad",
      "            tuning    narrow: decisions",
      "",
      "2026-10-08  🧬 evolved v1 → v2  claude",
      "            \"give me options\"",
      "            was  One-line summaries",
      "            now  One-line summaries, except decisions",
      "            why  narrow: decisions",
      "",
      "2026-10-09  ✓ trial v2",
      "",
    ].join("\n"),
  );
  assert.match(out, /2026-10-10 {2}🐣 hatched v2\n {12}"hatch it"\n {12}trials {2}✓3 ✗0 \(v2\)\n\n✓3 ✗1 across 2 versions {2}· {2}1 evolve {2}· {2}hatched 2026-10-10$/);
  assert.match(formatTimeline(b.get("terse"), [], { width: 100, color: false }, true), /nothing matches$/);
});

test("the history timeline wraps long fields under their label", () => {
  const home = mkdtempSync(join(tmpdir(), "deveggs-view-"));
  const b = new Basket(join(home, "basket"));
  b.lay({ id: "x", summary: "X", today: "2026-10-06" });
  b.feedback("x", { good: true, note: "word ".repeat(30).trim(), today: "2026-10-07" });
  const out = formatTimeline(b.get("x"), b.history("x"), { width: 60, color: false });
  for (const line of out.split("\n")) assert.ok(displayWidth(line) <= 60, `fits: ${line}`);
  assert.match(out, /\n {12}note {2}word word[^\n]*\n {18}word/);
});
