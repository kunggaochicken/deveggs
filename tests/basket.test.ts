import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withoutArchitecture } from "../src/architecture.ts";
import { Basket, BasketError, isReady, parseEgg, READY_AFTER, serializeEgg, slugify, TRIAL_PREFIX } from "../src/basket.ts";
import { formatEntry, formatHistory, type HistoryEntry, legacyHistory, movesFromLog, parseHistory } from "../src/history.ts";

const historyText = (b: Basket, tier: string, id: string): string => readFileSync(join(b.root, tier, `${id}.history.md`), "utf8");
const events = (b: Basket, id: string): string[] =>
  b.history(id).map((e) => `${e.date} ${e.event}${e.event === "trial" ? (e.good ? " ✓" : " ✗") : ""} v${e.version}`);

const fresh = (): Basket => new Basket(mkdtempSync(join(tmpdir(), "deveggs-")));

test("slugify makes short stable ids", () => {
  assert.equal(slugify("Always land changes through a PR, never push!"), "always-land-changes-through-a-pr-never-push");
  assert.throws(() => slugify("!!!"), BasketError);
});

test("lay takes a short id instead of the first words of the fact", () => {
  const b = fresh();
  const egg = b.lay({ id: "deveggs-github-account", summary: "Everything related to deveggs uses the kunggaochicken GitHub account" });
  assert.equal(egg.id, "deveggs-github-account");
  assert.ok(existsSync(join(b.root, "eggs", "deveggs-github-account.md")));
  assert.throws(() => b.lay({ id: "Deveggs GitHub", summary: "Bad id" }), /invalid id/);
  assert.throws(() => b.lay({ id: "deveggs-github-account", summary: "Same id" }), /already an egg/);
});

test("serialize/parse round-trips", () => {
  const b = fresh();
  const egg = b.lay({ summary: "Prefers terse summaries", tags: ["comms"], harness: "claude", note: "seen in grover", today: "2026-10-06" });
  assert.deepEqual(parseEgg(serializeEgg(egg), "egg"), egg);
});

test("new things are eggs on trial; --chicken skips the trial", () => {
  const b = fresh();
  assert.equal(b.lay({ summary: "Likes tables" }).tier, "egg");
  assert.equal(b.lay({ summary: "Never push to main", chicken: true }).tier, "chicken");
  assert.ok(existsSync(join(b.root, "eggs", "likes-tables.md")));
  assert.ok(existsSync(join(b.root, "chickens", "never-push-to-main.md")));
  assert.throws(() => b.lay({ summary: "Likes tables" }), /already an egg/);
});

test("feedback logs trials and an egg becomes ready after clean good trials", () => {
  const b = fresh();
  b.lay({ summary: "Likes tables" });
  let egg = b.feedback("likes-tables", { good: true, harness: "claude", note: "clearer diff summary", today: "2026-10-06" });
  for (let i = 1; i < READY_AFTER; i++) egg = b.feedback("likes-tables", { good: true, harness: "codex" });
  assert.equal(egg.good, READY_AFTER);
  assert.deepEqual(egg.harnesses, ["claude", "codex"]);
  assert.equal(withoutArchitecture(egg.body), "", "trials go to the history, not the item");
  const first = b.history("likes-tables").find((e) => e.event === "trial");
  assert.deepEqual(first, { date: "2026-10-06", event: "trial", version: 1, good: true, fields: { harness: "claude", note: "clearer diff summary" } });
  assert.ok(isReady(egg));
  assert.ok(!isReady(b.feedback("likes-tables", { good: false })));
});

test("hatch moves egg -> chicken; only eggs hatch; chickens take no feedback", () => {
  const b = fresh();
  b.lay({ summary: "Likes tables" });
  const chicken = b.hatch("likes-tables");
  assert.equal(chicken.tier, "chicken");
  assert.ok(!existsSync(join(b.root, "eggs", "likes-tables.md")));
  assert.throws(() => b.hatch("likes-tables"), /only eggs hatch/);
  assert.throws(() => b.feedback("likes-tables", { good: true }), /not an egg/);
});

test("skill eggs get a trial-marked SKILL.md that moves and is unmarked on hatch", () => {
  const b = fresh();
  b.lay({ summary: "Ship it checklist", kind: "skill" });
  const eggSkill = join(b.skillDir("egg", "ship-it-checklist"), "SKILL.md");
  assert.match(readFileSync(eggSkill, "utf8"), new RegExp(`description: \\${TRIAL_PREFIX.trim()} Ship it checklist`));
  b.hatch("ship-it-checklist");
  assert.ok(!existsSync(eggSkill));
  const chickenSkill = readFileSync(join(b.skillDir("chicken", "ship-it-checklist"), "SKILL.md"), "utf8");
  assert.match(chickenSkill, /^description: Ship it checklist$/m);
});

test("cracked things are never re-laid", () => {
  const b = fresh();
  b.lay({ summary: "Uses tabs" });
  b.crack("uses-tabs");
  assert.throws(() => b.lay({ summary: "Uses tabs" }), /cracked/);
});

test("render writes chickens and eggs as Markdown tables", () => {
  const b = fresh();
  b.lay({ summary: "Never push to main", chicken: true, tags: ["git"] });
  b.lay({ summary: "Try terse summaries", tags: ["comms"] });
  b.lay({ summary: "Run tests | then commit", kind: "workflow", tags: ["git", "testing"] });
  for (let i = 0; i < READY_AFTER; i++) b.feedback("try-terse-summaries", { good: true });
  b.feedback("run-tests-then-commit", { good: false });
  b.lay({ summary: "Rejected idea", tags: ["comms"] });
  b.crack("rejected-idea");
  const out = b.render();
  assert.equal(readFileSync(b.preferencesPath, "utf8"), out);
  const [chickens = "", eggs = ""] = out.split("## 🥚 Eggs");
  assert.match(chickens, /\| id \| fact \| tags \|\n\|---\|---\|---\|\n\| `never-push-to-main` \| Never push to main \| git \|/);
  assert.match(eggs, /\|  \| id \| fact \| tags \| trials \|/);
  assert.match(eggs, /\| 🐣 \| `try-terse-summaries` \| Try terse summaries \| comms \| ✓3 ✗0 \|/);
  assert.match(eggs, /\| 🥚 \| `run-tests-then-commit` \| Run tests \\\| then commit _\(workflow\)_ \| git, testing \| ✓0 ✗1 \|/);
  assert.doesNotMatch(out, /Rejected/);
});

test("render says so when a tier is empty", () => {
  const out = fresh().render();
  assert.equal(out.match(/_None yet\._/g)?.length, 2);
});

test("lay keeps the note in the item and records where it came from in its history", () => {
  const b = fresh();
  b.lay({
    summary: "Land changes through a PR",
    harness: "claude",
    note: "applies to every repo",
    origin: { quote: "always land changes\nthrough a PR", repo: "grover", session: "abc123" },
    today: "2026-10-06",
  });
  const egg = b.feedback("land-changes-through-a-pr", { good: true, today: "2026-10-07" });
  assert.equal(withoutArchitecture(egg.body), "## Notes\n\napplies to every repo");
  assert.equal(
    historyText(b, "eggs", "land-changes-through-a-pr"),
    "# land-changes-through-a-pr: history\n\n" +
      "<!-- Append-only log written by deveggs, oldest first. Read it with: deveggs history land-changes-through-a-pr -->\n\n" +
      "## 2026-10-06 · laid · v1\n\n> always land changes\n> through a PR\n\n" +
      "- fact: Land changes through a PR\n- harness: claude\n- repo: grover\n- session: abc123\n\n" +
      "## 2026-10-07 · trial ✓ · v1\n",
  );
  assert.deepEqual(b.all().map((e) => e.id), ["land-changes-through-a-pr"], "history files aren't items");
});

test("feedback records the verdict: scenario, result, cause, tuning and the developer's words", () => {
  const b = fresh();
  b.lay({ id: "terse", summary: "One-line summaries" });
  b.feedback("terse", {
    good: false,
    harness: "claude",
    repo: "grover",
    session: "s1",
    scenario: "design review with 4 trade-offs",
    result: "summary dropped the trade-offs",
    cause: "too broad",
    tuning: "narrow: decisions get a table",
    quote: "what were the options?",
    note: "first ✗",
    today: "2026-10-07",
  });
  const [, trial] = b.history("terse");
  assert.equal(
    formatEntry(trial as HistoryEntry),
    "## 2026-10-07 · trial ✗ · v1\n\n> what were the options?\n\n- harness: claude\n- repo: grover\n- session: s1\n" +
      "- scenario: design review with 4 trade-offs\n- result: summary dropped the trade-offs\n- cause: too broad\n" +
      "- tuning: narrow: decisions get a table\n- note: first ✗",
  );
});

test("history entries round-trip, keeping unknown fields and free text", () => {
  const entries: HistoryEntry[] = [
    { date: "2026-10-06", event: "laid", version: 1, quote: "two\nlines", fields: { fact: "X", custom: "kept" } },
    { date: "2026-10-07", event: "trial", version: 1, good: false, fields: { note: "a: b" }, text: "free text\n\nmore" },
    { date: "2026-10-08", event: "evolved", version: 2, fields: { was: "X", now: "Y" } },
  ];
  assert.deepEqual(parseHistory(formatHistory("x", entries)), entries);
});

test("a README.md at the basket root is not an egg", () => {
  const b = fresh();
  writeFileSync(join(b.root, "README.md"), "# my basket\n");
  b.lay({ summary: "Likes tables" });
  assert.deepEqual(b.all().map((e) => e.id), ["likes-tables"]);
  assert.doesNotMatch(b.render(), /my basket/);
});

test("the basket README template ships outside my-basket/", () => {
  const template = readFileSync(new URL("../templates/basket-README.md", import.meta.url), "utf8");
  assert.match(template, /<owner>/);
  assert.match(template, /https:\/\/github\.com\/kunggaochicken\/deveggs/);
});

// --- evolve --------------------------------------------------------------------

test("evolve changes the fact, keeps id, tier, tags and history, and logs was/now/why", () => {
  const b = fresh();
  b.lay({ id: "terse", summary: "End each turn with a one-line summary", tags: ["comms"], harness: "claude", note: "keep it short", origin: { quote: "one line please", repo: "grover" }, today: "2026-10-06" });
  b.feedback("terse", { good: true, harness: "claude", today: "2026-10-07" });
  const egg = b.evolve("terse", {
    summary: "End each turn with a one-line summary, except for decisions",
    quote: "for decisions give me the options",
    note: "narrow: decisions need the trade-offs",
    harness: "codex",
    repo: "grover",
    session: "abc",
    today: "2026-10-08",
  });
  assert.equal(egg.id, "terse");
  assert.equal(egg.tier, "egg");
  assert.deepEqual(egg.tags, ["comms"]);
  assert.equal(egg.version, 2);
  assert.equal(egg.summary, "End each turn with a one-line summary, except for decisions");
  assert.equal(egg.updated, "2026-10-08");
  assert.deepEqual(egg.harnesses, ["claude", "codex"]);
  assert.equal(withoutArchitecture(egg.body), "## Notes\n\nkeep it short");
  assert.match(
    historyText(b, "eggs", "terse"),
    /## 2026-10-08 · evolved · v2\n\n> for decisions give me the options\n\n- harness: codex\n- repo: grover\n- session: abc\n- was: End each turn with a one-line summary\n- now: End each turn with a one-line summary, except for decisions\n- why: narrow: decisions need the trade-offs\n$/,
  );
  assert.deepEqual(b.get("terse"), egg, "round-trips through the file");
  assert.match(readFileSync(join(b.root, "eggs", "terse.md"), "utf8"), /^version: 2$/m);
});

test("evolve keeps lineage across versions, oldest first", () => {
  const b = fresh();
  b.lay({ id: "x", summary: "One", today: "2026-10-06" });
  b.evolve("x", { summary: "Two", quote: "make it two", today: "2026-10-07" });
  b.evolve("x", { summary: "Three", today: "2026-10-08" });
  assert.deepEqual(
    b.history("x").filter((e) => e.event === "evolved").map((e) => [e.version, e.date, e.fields["was"], e.fields["now"], e.quote]),
    [[2, "2026-10-07", "One", "Two", "make it two"], [3, "2026-10-08", "Two", "Three", undefined]],
  );
});

test("after evolve, hatch readiness counts only trials under the new version", () => {
  const b = fresh();
  b.lay({ id: "x", summary: "One", today: "2026-10-06" });
  for (let i = 0; i < READY_AFTER; i++) b.feedback("x", { good: true, today: "2026-10-07" });
  assert.ok(isReady(b.get("x")));
  let egg = b.evolve("x", { summary: "Two", today: "2026-10-08" });
  assert.equal(egg.good, 0);
  assert.equal(egg.bad, 0);
  assert.ok(!isReady(egg), "the old rule's ✓s don't hatch the new one");
  for (let i = 0; i < READY_AFTER; i++) egg = b.feedback("x", { good: true, today: "2026-10-09" });
  assert.ok(isReady(egg));
  assert.deepEqual(events(b, "x"), [
    "2026-10-06 laid v1",
    "2026-10-07 trial ✓ v1", "2026-10-07 trial ✓ v1", "2026-10-07 trial ✓ v1",
    "2026-10-08 evolved v2",
    "2026-10-09 trial ✓ v2", "2026-10-09 trial ✓ v2", "2026-10-09 trial ✓ v2",
  ]);
});

test("a chicken that evolves stays a chicken; cracked items don't evolve", () => {
  const b = fresh();
  b.lay({ id: "no-push", summary: "Never push to main", chicken: true });
  const chicken = b.evolve("no-push", { summary: "Never push to main or release branches" });
  assert.equal(chicken.tier, "chicken");
  assert.equal(chicken.version, 2);
  assert.ok(existsSync(join(b.root, "chickens", "no-push.md")));
  assert.ok(!existsSync(join(b.root, "eggs", "no-push.md")));
  b.lay({ id: "tabs", summary: "Use tabs" });
  b.crack("tabs");
  assert.throws(() => b.evolve("tabs", { summary: "Use spaces" }), /cracked/);
  assert.throws(() => b.evolve("nope", { summary: "x" }), /nothing in the basket/);
  assert.throws(() => b.evolve("no-push", { summary: "Never push to main or release branches" }), /already says that/);
  assert.throws(() => b.evolve("no-push", { summary: "  " }), /empty/);
});

test("evolving a skill updates its SKILL.md description, keeping the trial marker", () => {
  const b = fresh();
  b.lay({ id: "ship", kind: "skill", summary: "Ship it checklist" });
  b.evolve("ship", { summary: "Ship it checklist with screenshots" });
  const skill = readFileSync(join(b.skillDir("egg", "ship"), "SKILL.md"), "utf8");
  assert.match(skill, new RegExp(`^description: \\${TRIAL_PREFIX.trim()} Ship it checklist with screenshots$`, "m"));
});

test("render marks evolved eggs with their version", () => {
  const b = fresh();
  b.lay({ id: "x", summary: "One" });
  b.evolve("x", { summary: "Two" });
  assert.match(b.render(), /\| 🥚 \| `x` \| Two \| general \| ✓0 ✗0 \(v2\) \|/);
});

test("rename moves the item and its history, keeps its tier and trials, and logs the old id", () => {
  const b = fresh();
  b.lay({ id: "parallel", summary: "Use subagents", chicken: true, origin: { quote: "do these in parallel" }, today: "2026-10-06" });
  b.evolve("parallel", { summary: "Always delegate to subagents", today: "2026-10-07" });
  const { egg } = b.rename("parallel", "delegate", { today: "2026-10-08", note: "clearer name", quote: "call it delegate" });
  assert.equal(egg.id, "delegate");
  assert.equal(egg.tier, "chicken");
  assert.equal(egg.version, 2);
  assert.equal(egg.updated, "2026-10-08");
  assert.ok(!existsSync(join(b.root, "chickens", "parallel.md")));
  assert.ok(!existsSync(join(b.root, "chickens", "parallel.history.md")));
  assert.match(readFileSync(join(b.root, "chickens", "delegate.md"), "utf8"), /^id: delegate$/m);
  const text = historyText(b, "chickens", "delegate");
  assert.match(text, /^# delegate: history\n/);
  assert.match(text, /## 2026-10-08 · renamed · v2\n\n> call it delegate\n\n- from: parallel\n- to: delegate\n- why: clearer name\n$/);
  assert.deepEqual(events(b, "delegate"), ["2026-10-06 laid v1", "2026-10-07 evolved v2", "2026-10-08 renamed v2"]);
  assert.deepEqual(b.get("delegate"), egg, "round-trips through the file");
  assert.throws(() => b.get("parallel"), /nothing in the basket/);
});

test("rename keeps the trial log, and renames cracked items too", () => {
  const b = fresh();
  b.lay({ id: "tabs", summary: "Use tabs", today: "2026-10-06" });
  b.feedback("tabs", { good: false, today: "2026-10-07" });
  b.crack("tabs", { today: "2026-10-07" });
  const { egg } = b.rename("tabs", "tab-indent", { today: "2026-10-08" });
  assert.equal(egg.tier, "cracked");
  assert.deepEqual(events(b, "tab-indent"), ["2026-10-06 laid v1", "2026-10-07 trial ✗ v1", "2026-10-07 cracked v1", "2026-10-08 renamed v1"]);
});

test("rename rewrites `old-id` and [[old-id]] references in other items and skills, not in itself", () => {
  const b = fresh();
  b.lay({ id: "parallel", summary: "Use subagents", note: "Self: `parallel`" });
  b.lay({ id: "guardian", summary: "Watch memory", note: "## Works with\n\n- `parallel`: fan out\n- [[parallel]] and [[parallel|alias]]\n- `parallel-ish` and parallel stay" });
  b.lay({ id: "ship", kind: "skill", summary: "Ship it", chicken: true });
  const skill = join(b.skillDir("chicken", "ship"), "SKILL.md");
  writeFileSync(skill, `${readFileSync(skill, "utf8")}See \`parallel\`.\n`);
  const { rewrote } = b.rename("parallel", "delegate");
  assert.deepEqual(rewrote.sort(), [join(b.root, "eggs", "guardian.md"), skill].sort());
  assert.match(b.get("guardian").body, /- `delegate`: fan out\n- \[\[delegate\]\] and \[\[delegate\|alias\]\]\n- `parallel-ish` and parallel stay/);
  assert.match(readFileSync(skill, "utf8"), /See `delegate`\./);
  assert.match(b.get("delegate").body, /## Notes\n\nSelf: `parallel`/, "it doesn't rewrite itself");
});

test("rename moves a skill folder and renames the skill inside", () => {
  const b = fresh();
  b.lay({ id: "ship", kind: "skill", summary: "Ship it checklist" });
  b.rename("ship", "ship-checklist");
  assert.ok(!existsSync(b.skillDir("egg", "ship")));
  const skill = readFileSync(join(b.skillDir("egg", "ship-checklist"), "SKILL.md"), "utf8");
  assert.match(skill, /^name: ship-checklist$/m);
  assert.match(skill, /^# ship-checklist$/m);
  assert.match(skill, new RegExp(`^description: \\${TRIAL_PREFIX.trim()} Ship it checklist$`, "m"));
});

test("rename refuses a missing item, a taken id, an invalid id and a clashing skill folder", () => {
  const b = fresh();
  b.lay({ id: "a", summary: "A" });
  b.lay({ id: "b", summary: "B" });
  b.lay({ id: "c", summary: "C" });
  b.crack("c");
  assert.throws(() => b.rename("nope", "x"), /nothing in the basket/);
  assert.throws(() => b.rename("a", "b"), /already in the basket \(egg\)/);
  assert.throws(() => b.rename("a", "c"), /already in the basket \(cracked\)/);
  assert.throws(() => b.rename("a", "A B"), /invalid id/);
  assert.throws(() => b.rename("a", "a"), /already called that/);
  mkdirSync(b.skillDir("chicken", "d"), { recursive: true });
  assert.throws(() => b.rename("a", "d"), /skill folder .* already exists/);
  assert.ok(existsSync(join(b.root, "eggs", "a.md")), "nothing moved");
});

test("rename leaves other items' history alone", () => {
  const b = fresh();
  b.lay({ id: "foo", summary: "Foo" });
  b.rename("foo", "older", { today: "2026-10-07" });
  b.lay({ id: "foo", summary: "New foo" });
  b.lay({ id: "x", summary: "X", note: "Works with `foo`" });
});

// --- history: hatch, crack, legacy migration -------------------------------------

test("hatch and crack log the trial record and the developer's say-so", () => {
  const b = fresh();
  b.lay({ id: "x", summary: "One", today: "2026-10-06" });
  for (let i = 0; i < READY_AFTER; i++) b.feedback("x", { good: true, harness: "claude", today: "2026-10-07" });
  b.hatch("x", { today: "2026-10-08", quote: "yes hatch it", harness: "claude" });
  const hatched = b.history("x").at(-1);
  assert.deepEqual(hatched, { date: "2026-10-08", event: "hatched", version: 1, quote: "yes hatch it", fields: { harness: "claude", trials: "✓3 ✗0 (v1)" } });
  assert.ok(existsSync(join(b.root, "chickens", "x.history.md")), "the history moves with the item");
  assert.ok(!existsSync(join(b.root, "eggs", "x.history.md")));
  b.crack("x", { today: "2026-10-09", note: "retired: superseded" });
  assert.equal(b.history("x").at(-1)?.fields["why"], "retired: superseded");
  assert.ok(existsSync(join(b.root, "cracked", "x.history.md")));
  assert.throws(() => b.crack("x"), /already cracked/);
});

/** An item file from before history files: Origin, Evolution (with a rename) and Trials in the body. */
const LEGACY = [
  "---",
  "id: delegate",
  "kind: preference",
  "tags: workflow",
  "harnesses: claude-code, claude",
  "good: 0",
  "bad: 0",
  "version: 3",
  "laid: 2026-10-07",
  "updated: 2026-10-10",
  "---",
  "Always delegate work to subagents",
  "",
  "A hand-written note.",
  "",
  "## Origin",
  "",
  "> do these in parallel subagent",
  "",
  "- 2026-10-07 · claude-code · cuskeel · session f4d5",
  "a stray origin line",
  "",
  "## Works with",
  "",
  "- `memory-guardian`: fan out freely",
  "",
  "## Evolution",
  "",
  "### v2 · 2026-10-10 · claude · grover",
  "",
  "> delegate by default",
  "",
  "- was: Hand side tasks to a parallel subagent",
  "- now: By default, hand implementation work to subagents",
  "- why: widen: implementation work by default",
  "",
  "### v3 · 2026-10-10 · claude-code · umibozu",
  "",
  "> shouldn't these all be in a subagent?",
  "",
  "- was: By default, hand implementation work to subagents",
  "- now: Always delegate work to subagents",
  "- why: reword: triage stayed inline",
  "",
  "### renamed · 2026-10-10",
  "",
  "- renamed from: `parallel-subagents`",
  "",
  "## Trials",
  "",
  "- 2026-10-07 ✓ (claude-code) PRs ran as parallel subagents",
  "- 2026-10-09 ✗ (claude) paused B and brainstormed inline",
  "",
  "### v2",
  "",
  "- 2026-10-10 ✓ (claude) builds ran as background agents",
  "- 2026-10-10 ✗ (claude-code) triage stayed inline",
  "",
].join("\n");

test("movesFromLog finds hatches and cracks and follows renames to the current id", () => {
  const log = [
    "2026-10-10\tchicken: rename parallel-subagents to delegate-subagents",
    "2026-10-10\tchicken: hatch parallel-subagents",
    "2026-10-09\tcrack: memory-guardian",
    "2026-10-08\ttrial: good parallel-subagents",
  ].join("\n");
  assert.deepEqual(movesFromLog(log), [
    { id: "memory-guardian", event: "cracked", date: "2026-10-09" },
    { id: "delegate-subagents", event: "hatched", date: "2026-10-10" },
  ]);
});

test("migrateHistory moves Origin, Evolution and Trials into the history file without losing anything", () => {
  const b = fresh();
  mkdirSync(join(b.root, "chickens"), { recursive: true });
  writeFileSync(join(b.root, "chickens", "delegate.md"), LEGACY);
  const before = b.history("delegate");
  assert.deepEqual(b.migrateHistory([{ id: "delegate", event: "hatched", date: "2026-10-10" }]), ["delegate"]);
  const egg = b.get("delegate");
  assert.equal(egg.body, "A hand-written note.\n\n## Works with\n\n- `memory-guardian`: fan out freely", "only the current rule's notes stay");
  assert.equal(egg.version, 3);
  assert.deepEqual(events(b, "delegate"), [
    "2026-10-07 laid v1",
    "2026-10-07 trial ✓ v1",
    "2026-10-09 trial ✗ v1",
    "2026-10-10 evolved v2",
    "2026-10-10 trial ✓ v2",
    "2026-10-10 trial ✗ v2",
    "2026-10-10 evolved v3",
    "2026-10-10 hatched v3",
    "2026-10-10 renamed v3",
  ]);
  assert.deepEqual(b.history("delegate").at(-1)?.fields, { from: "parallel-subagents", to: "delegate" });
  const [laid] = b.history("delegate");
  assert.deepEqual(laid, {
    date: "2026-10-07",
    event: "laid",
    version: 1,
    quote: "do these in parallel subagent",
    fields: { fact: "Hand side tasks to a parallel subagent", harness: "claude-code", repo: "cuskeel", session: "f4d5" },
    text: "(from ## Origin)\na stray origin line",
  });
  const text = historyText(b, "chickens", "delegate");
  for (const line of LEGACY.split("\n").slice(15).filter((l) => !l.startsWith("#"))) {
    const words = line.replace(/^- renamed from: /, "").replace(/^[-#>]+ ?|`|\(|\)|·/g, " ").split(/\s+/).filter((w) => w.length > 3 && !/^v\d$/.test(w));
    for (const word of words) assert.ok(text.includes(word) || egg.body.includes(word), `lost ${JSON.stringify(word)} from ${JSON.stringify(line)}`);
  }
  assert.deepEqual(before.filter((e) => e.event !== "hatched"), b.history("delegate").filter((e) => e.event !== "hatched"), "reading legacy sections gives the same history");
  assert.deepEqual(b.migrateHistory(), [], "idempotent");
});

test("a legacy item gets its history file on its first write, and items with no history start one", () => {
  const b = fresh();
  mkdirSync(join(b.root, "eggs"), { recursive: true });
  writeFileSync(join(b.root, "eggs", "old.md"), "---\nid: old\nkind: preference\ntags: \nharnesses: \ngood: 0\nbad: 0\nlaid: 2026-10-01\nupdated: 2026-10-01\n---\nOld\n\n## Origin\n\n- 2026-10-01 · grover\n\n## Trials\n\n- 2026-10-02 ✓\n");
  writeFileSync(join(b.root, "eggs", "bare.md"), "---\nid: bare\nkind: preference\ntags: \nharnesses: \ngood: 0\nbad: 0\nlaid: 2026-10-01\nupdated: 2026-10-01\n---\nBare\n");
  b.feedback("old", { good: false, today: "2026-10-03" });
  assert.equal(b.get("old").body, "");
  assert.deepEqual(events(b, "old"), ["2026-10-01 laid v1", "2026-10-02 trial ✓ v1", "2026-10-03 trial ✗ v1"]);
  assert.equal(b.history("old")[0]?.fields["repo"], "grover");
  assert.deepEqual(b.needsHistoryMigration().map((e) => e.id), ["bare"]);
  b.migrateHistory();
  assert.deepEqual(events(b, "bare"), ["2026-10-01 laid v1"]);
});

test("legacyHistory reads a borrowed-from Origin row as an import", () => {
  const egg = parseEgg("---\nid: x\nkind: preference\ntags: \nharnesses: \ngood: 0\nbad: 0\nlaid: 2026-10-05\nupdated: 2026-10-05\n---\nX\n\n## Origin\n\n> theirs\n- 2026-10-05 · borrowed from jane · kunggaochicken/deveggs-baskets\n", "egg");
  assert.deepEqual(legacyHistory(egg).map((e) => [e.event, e.fields["from"], e.fields["basket"]]), [
    ["laid", undefined, undefined],
    ["imported", "jane", "kunggaochicken/deveggs-baskets"],
  ]);
});

// --- review fixes: legacy edge cases ----------------------------------------------

const legacyItem = (id: string, body: string, front = ""): string =>
  `---\nid: ${id}\nkind: preference\ntags: \nharnesses: claude\ngood: 0\nbad: 0\n${front}laid: 2026-10-05\nupdated: 2026-10-06\n---\n${id} rule\n\n${body}\n`;

test("migration keeps undated Origin rows and Evolution headings instead of dropping their entries", () => {
  const b = fresh();
  mkdirSync(join(b.root, "eggs"), { recursive: true });
  writeFileSync(join(b.root, "eggs", "x.md"), legacyItem("x", [
    "## Origin", "", "> my words", "", "- worked out in a standup", "",
    "## Evolution", "", "### v2", "", "- was: Use `grep`", "- now: Use `rg` instead of `grep`",
  ].join("\n"), "version: 2\n"));
  b.migrateHistory();
  const entries = parseHistory(historyText(b, "eggs", "x"));
  assert.deepEqual(entries.map((e) => `${e.date} ${e.event}`), ["2026-10-05 laid", "2026-10-06 evolved"]);
  assert.equal(entries[0]?.quote, "my words");
  assert.match(entries[0]?.text ?? "", /- worked out in a standup/);
  assert.equal(entries[0]?.fields["fact"], "Use `grep`", "backticks survive");
  assert.equal(entries[1]?.fields["now"], "Use `rg` instead of `grep`");
});

test("legacy sections written into a migrated item merge without a second lay", () => {
  const b = fresh();
  b.lay({ id: "x", summary: "X", origin: { quote: "mine" }, today: "2026-10-05" });
  const file = join(b.root, "eggs", "x.md");
  writeFileSync(file, `${readFileSync(file, "utf8").trimEnd()}\n\n## Trials\n\n- 2026-10-06 ✓ (codex) an older deveggs wrote this\n`);
  assert.deepEqual(events(b, "x"), ["2026-10-05 laid v1", "2026-10-06 trial ✓ v1"]);
  b.feedback("x", { good: true, today: "2026-10-07" });
  assert.deepEqual(events(b, "x"), ["2026-10-05 laid v1", "2026-10-06 trial ✓ v1", "2026-10-07 trial ✓ v1"]);
  assert.equal(b.history("x")[0]?.quote, "mine");
});

test("multi-line legacy trial notes stay with their trial", () => {
  const b = fresh();
  mkdirSync(join(b.root, "eggs"), { recursive: true });
  writeFileSync(join(b.root, "eggs", "x.md"), legacyItem("x", "## Trials\n\n- 2026-10-06 ✗ (claude) first line\n  and its second line"));
  const trial = b.history("x").find((e) => e.event === "trial");
  assert.equal(trial?.text, "and its second line");
});

test("an item borrowed before history files is laid no later than its owner's evolves", () => {
  const b = fresh();
  mkdirSync(join(b.root, "eggs"), { recursive: true });
  writeFileSync(join(b.root, "eggs", "x.md"), legacyItem("x", [
    "## Origin", "", "> theirs", "- 2026-10-05 · borrowed from jane · kunggaochicken/deveggs-baskets", "",
    "## Evolution", "", "### v2 · 2026-03-01", "", "- was: A", "- now: B",
  ].join("\n"), "version: 2\n"));
  assert.deepEqual(events(b, "x"), ["2026-03-01 laid v1", "2026-03-01 evolved v2", "2026-10-05 imported v2"]);
});

test("movesFromLog carries only earlier moves across a rename, and a revived id ignores older moves", () => {
  const log = [
    "2026-10-04\tchicken: hatch foo",
    "2026-10-03\tegg: lay foo",
    "2026-10-02\tegg: rename foo to bar",
    "2026-10-01\tcrack: foo",
  ].join("\n");
  assert.deepEqual(movesFromLog(log), [
    { id: "bar", event: "cracked", date: "2026-10-01" },
    { id: "foo", event: "hatched", date: "2026-10-04" },
  ]);
  const egg = parseEgg(legacyItem("foo", "## Origin\n\n- 2026-10-03 · grover").replace("laid: 2026-10-05", "laid: 2026-10-03"), "chicken");
  assert.deepEqual(legacyHistory(egg, [{ id: "foo", event: "cracked", date: "2026-09-01" }]).map((e) => e.event), ["laid"]);
});

test("rename starts a history for an item that had none, and a revived id gets its old history back", () => {
  const b = fresh();
  mkdirSync(join(b.root, "eggs"), { recursive: true });
  writeFileSync(join(b.root, "eggs", "bare.md"), legacyItem("bare", ""));
  b.rename("bare", "plain", { today: "2026-10-08" });
  assert.deepEqual(events(b, "plain"), ["2026-10-05 laid v1", "2026-10-08 renamed v1"]);
  b.crack("plain", { today: "2026-10-09" });
  assert.throws(() => b.lay({ id: "plain", summary: "Again" }), /delete cracked\/plain\.md to revive it/);
  rmSync(join(b.root, "cracked", "plain.md"));
  b.lay({ id: "plain", summary: "Again", today: "2026-10-10" });
  assert.deepEqual(events(b, "plain"), ["2026-10-05 laid v1", "2026-10-08 renamed v1", "2026-10-09 cracked v1", "2026-10-10 laid v1"]);
  assert.ok(!existsSync(join(b.root, "cracked", "plain.history.md")));
});
