import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Basket, BasketError, parseEgg, serializeEgg, slugify } from "../src/basket.ts";

const fresh = (): Basket => new Basket(mkdtempSync(join(tmpdir(), "deveggs-")));

test("slugify makes short stable ids", () => {
  assert.equal(slugify("Always land changes through a PR, never push!"), "always-land-changes-through-a-pr-never-push");
  assert.throws(() => slugify("!!!"), BasketError);
});

test("serialize/parse round-trips", () => {
  const b = fresh();
  const egg = b.lay({ summary: "Prefers terse summaries", tags: ["comms"], harness: "claude", body: "seen in grover", today: "2026-10-06" });
  assert.deepEqual(parseEgg(serializeEgg(egg)), egg);
});

test("explicit eggs hatch immediately; inferred ones wait", () => {
  const b = fresh();
  assert.equal(b.lay({ summary: "Never push to main", source: "explicit" }).status, "hatched");
  assert.equal(b.lay({ summary: "Likes tables" }).status, "egg");
});

test("re-laying warms, tracks harnesses, and surfaces warm eggs", () => {
  const b = fresh();
  b.lay({ summary: "Likes tables", harness: "claude" });
  assert.deepEqual(b.warmEggs(), []);
  const egg = b.lay({ summary: "Likes tables", harness: "codex" });
  assert.equal(egg.sightings, 2);
  assert.deepEqual(egg.harnesses, ["claude", "codex"]);
  assert.deepEqual(b.warmEggs().map((e) => e.id), ["likes-tables"]);
});

test("cracked eggs are never re-laid", () => {
  const b = fresh();
  b.lay({ summary: "Uses tabs" });
  b.crack("uses-tabs");
  assert.throws(() => b.lay({ summary: "Uses tabs" }), /cracked/);
});

test("render groups hatched preferences by tag and skips the rest", () => {
  const b = fresh();
  b.lay({ summary: "Never push to main", source: "explicit", tags: ["git"] });
  b.lay({ summary: "Answer tersely", source: "explicit", tags: ["comms"] });
  b.lay({ summary: "Maybe likes emoji", tags: ["comms"] });
  b.lay({ summary: "Release checklist", source: "explicit", kind: "workflow" });
  b.render();
  const out = readFileSync(b.preferencesPath, "utf8");
  assert.match(out, /## comms\n\n- Answer tersely\n\n## git\n\n- Never push to main/);
  assert.doesNotMatch(out, /emoji|Release/);
});
