import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Basket, BasketError, formatOrigin, isReady, parseEgg, READY_AFTER, serializeEgg, slugify, TRIAL_PREFIX } from "../src/basket.ts";

const fresh = (): Basket => new Basket(mkdtempSync(join(tmpdir(), "deveggs-")));

test("slugify makes short stable ids", () => {
  assert.equal(slugify("Always land changes through a PR, never push!"), "always-land-changes-through-a-pr-never-push");
  assert.throws(() => slugify("!!!"), BasketError);
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

test("render lists chickens as permanent and eggs as on trial", () => {
  const b = fresh();
  b.lay({ summary: "Never push to main", chicken: true, tags: ["git"] });
  b.lay({ summary: "Try terse summaries", tags: ["comms"] });
  b.lay({ summary: "Rejected idea", tags: ["comms"] });
  b.crack("rejected-idea");
  const out = b.render();
  const [chickens = "", eggs = ""] = out.split("## 🥚 Eggs");
  assert.match(chickens, /### git\n\n- Never push to main/);
  assert.match(eggs, /### comms\n\n- Try terse summaries `try-terse-summaries`/);
  assert.doesNotMatch(out, /Rejected/);
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
