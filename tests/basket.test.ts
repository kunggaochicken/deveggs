import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Basket, BasketError, formatOrigin, isReady, parseEgg, parseEvolution, READY_AFTER, serializeEgg, slugify, TRIAL_PREFIX } from "../src/basket.ts";

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
  assert.match(egg.body, /## Trials\n\n- 2026-10-06 ✓ \(claude\) clearer diff summary/);
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

test("lay records where the egg came from, ahead of the trial log", () => {
  const b = fresh();
  b.lay({
    summary: "Land changes through a PR",
    harness: "claude",
    note: "applies to every repo",
    origin: { quote: "always land changes\nthrough a PR", repo: "grover", session: "abc123" },
    today: "2026-10-06",
  });
  const egg = b.feedback("land-changes-through-a-pr", { good: true, today: "2026-10-07" });
  assert.equal(
    egg.body,
    "applies to every repo\n\n## Origin\n\n> always land changes\n> through a PR\n\n" +
      "- 2026-10-06 · claude · grover · session abc123\n\n## Trials\n\n- 2026-10-07 ✓",
  );
});

test("origin without a quote still records when and where", () => {
  assert.equal(formatOrigin("2026-10-06", undefined, {}), "## Origin\n\n- 2026-10-06");
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

test("evolve changes the fact, keeps id, tier, tags and origin, and records was/now/why", () => {
  const b = fresh();
  b.lay({ id: "terse", summary: "End each turn with a one-line summary", tags: ["comms"], harness: "claude", origin: { quote: "one line please", repo: "grover" }, today: "2026-10-06" });
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
  assert.equal(
    egg.body,
    "## Origin\n\n> one line please\n\n- 2026-10-06 · claude · grover\n\n" +
      "## Evolution\n\n### v2 · 2026-10-08 · codex · grover · session abc\n\n> for decisions give me the options\n\n" +
      "- was: End each turn with a one-line summary\n- now: End each turn with a one-line summary, except for decisions\n" +
      "- why: narrow: decisions need the trade-offs\n\n## Trials\n\n- 2026-10-07 ✓ (claude)",
  );
  assert.deepEqual(b.get("terse"), egg, "round-trips through the file");
  assert.match(readFileSync(join(b.root, "eggs", "terse.md"), "utf8"), /^version: 2$/m);
});

test("evolve keeps lineage across versions, oldest first", () => {
  const b = fresh();
  b.lay({ id: "x", summary: "One" });
  b.evolve("x", { summary: "Two", quote: "make it two", today: "2026-10-07" });
  const egg = b.evolve("x", { summary: "Three", today: "2026-10-08" });
  assert.equal(egg.version, 3);
  assert.deepEqual(
    parseEvolution(egg.body).map((e) => [e.version, e.date, e.was, e.now, e.quote]),
    [[2, "2026-10-07", "One", "Two", "make it two"], [3, "2026-10-08", "Two", "Three", ""]],
  );
  assert.equal(egg.body.match(/^## Evolution$/gm)?.length, 1);
});

test("after evolve, hatch readiness counts only trials under the new version", () => {
  const b = fresh();
  b.lay({ id: "x", summary: "One" });
  for (let i = 0; i < READY_AFTER; i++) b.feedback("x", { good: true });
  assert.ok(isReady(b.get("x")));
  let egg = b.evolve("x", { summary: "Two" });
  assert.equal(egg.good, 0);
  assert.equal(egg.bad, 0);
  assert.ok(!isReady(egg), "the old rule's ✓s don't hatch the new one");
  for (let i = 0; i < READY_AFTER; i++) egg = b.feedback("x", { good: true, today: "2026-10-09" });
  assert.ok(isReady(egg));
  // Earlier trials stay in the log; new ones go under a v2 marker, added once.
  assert.match(egg.body, /## Trials\n\n(- \S+ ✓\n){3}\n### v2\n\n- 2026-10-09 ✓\n- 2026-10-09 ✓\n- 2026-10-09 ✓$/);
});

test("trials after an evolve with no log yet start under the version marker", () => {
  const b = fresh();
  b.lay({ id: "x", summary: "One" });
  b.evolve("x", { summary: "Two" });
  const egg = b.feedback("x", { good: false, today: "2026-10-09" });
  assert.match(egg.body, /## Evolution[\s\S]*## Trials\n\n### v2\n\n- 2026-10-09 ✗$/);
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

test("rename moves the item, keeps its tier, trials and history, and notes the old id under Evolution", () => {
  const b = fresh();
  b.lay({ id: "parallel", summary: "Use subagents", chicken: true, origin: { quote: "do these in parallel" }, today: "2026-10-06" });
  b.evolve("parallel", { summary: "Always delegate to subagents", today: "2026-10-07" });
  const { egg } = b.rename("parallel", "delegate", "2026-10-08");
  assert.equal(egg.id, "delegate");
  assert.equal(egg.tier, "chicken");
  assert.equal(egg.version, 2);
  assert.equal(egg.updated, "2026-10-08");
  assert.ok(!existsSync(join(b.root, "chickens", "parallel.md")));
  assert.match(readFileSync(join(b.root, "chickens", "delegate.md"), "utf8"), /^id: delegate$/m);
  assert.match(egg.body, /## Evolution\n\n### v2 · 2026-10-07\n[\s\S]*\n\n### renamed · 2026-10-08\n\n- renamed from: `parallel`$/);
  const lineage = parseEvolution(egg.body);
  assert.deepEqual(lineage.map((e) => [e.version, e.renamedFrom]), [[2, undefined], [0, "parallel"]]);
  assert.deepEqual(b.get("delegate"), egg, "round-trips through the file");
  assert.throws(() => b.get("parallel"), /nothing in the basket/);
});

test("rename puts the Evolution note before the trial log, and renames cracked items too", () => {
  const b = fresh();
  b.lay({ id: "tabs", summary: "Use tabs" });
  b.feedback("tabs", { good: false, today: "2026-10-07" });
  b.crack("tabs");
  const { egg } = b.rename("tabs", "tab-indent", "2026-10-08");
  assert.equal(egg.tier, "cracked");
  assert.match(egg.body, /## Evolution\n\n### renamed · 2026-10-08\n\n- renamed from: `tabs`\n\n## Trials\n\n- 2026-10-07 ✗$/);
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
  assert.match(b.get("delegate").body, /^Self: `parallel`/, "its own history keeps the old id");
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

test("rename leaves other items' Evolution history alone", () => {
  const b = fresh();
  b.lay({ id: "foo", summary: "Foo" });
  b.rename("foo", "older", "2026-10-07");
  b.lay({ id: "foo", summary: "New foo" });
  b.lay({ id: "x", summary: "X", note: "Works with `foo`" });
  b.rename("foo", "bar", "2026-10-08");
  assert.match(b.get("older").body, /- renamed from: `foo`$/);
  assert.match(b.get("x").body, /^Works with `bar`/);
});
