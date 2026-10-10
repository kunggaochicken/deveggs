import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, git, sandbox, subjects } from "./sandbox.ts";

test("feedback records the verdict fields and history shows, filters and exports them", () => {
  const box = sandbox();
  assert.equal(cli(box, "lay", "One-line summaries", "--id", "terse", "--quote", "one line please", "--harness", "claude").status, 0);
  const bad = cli(box, "feedback", "terse", "--bad", "--harness", "codex", "--repo", "grover", "--scenario", "design review",
    "--result", "lost the trade-offs", "--cause", "too broad", "--tuning", "narrow: decisions", "--quote", "what were the options?");
  assert.equal(bad.status, 0, bad.stderr);
  cli(box, "evolve", "terse", "One-line summaries, except decisions", "--quote", "give me options", "--note", "narrow: decisions");
  cli(box, "feedback", "terse", "--good", "--note", "table helped");
  assert.equal(git(box, box.basket, "status", "--porcelain"), "", "everything committed");
  assert.ok(existsSync(join(box.basket, "eggs", "terse.history.md")));

  const all = cli(box, "history", "terse");
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /🥚 laid v1  claude\n {12}"one line please"/);
  assert.match(all.stdout, /✗ trial v1  codex · grover\n {12}"what were the options\?"\n {12}scenario  design review\n {12}result    lost the trade-offs\n {12}cause     too broad\n {12}tuning    narrow: decisions/);
  assert.match(all.stdout, /🧬 evolved v1 → v2/);

  const trials = cli(box, "history", "terse", "--trials").stdout;
  assert.match(trials, /· 2 matching events\n/);
  assert.doesNotMatch(trials, /laid|evolved/);
  const v2 = cli(box, "history", "terse", "--version", "2", "--event", "trial").stdout;
  assert.match(v2, /table helped/);
  assert.doesNotMatch(v2, /design review/);
  assert.match(cli(box, "history", "terse", "--since", "2999-01-01").stdout, /nothing matches/);

  const json = JSON.parse(cli(box, "history", "terse", "--json").stdout) as { id: string; version: number; entries: Array<{ event: string; good?: boolean; fields: Record<string, string> }> };
  assert.equal(json.id, "terse");
  assert.equal(json.version, 2);
  assert.deepEqual(json.entries.map((e) => e.event), ["laid", "trial", "evolved", "trial"]);
  assert.equal(json.entries[1]?.fields["cause"], "too broad");

  assert.match(cli(box, "history", "terse", "--event", "nope").stderr, /invalid event "nope"/);
  assert.match(cli(box, "history", "terse", "--since", "yesterday").stderr, /invalid --since/);
  assert.match(cli(box, "history", "terse", "--version", "x").stderr, /invalid --version/);
  assert.match(cli(box, "history", "nope").stderr, /nothing in the basket named "nope"/);
});

test("hatch and crack take the developer's words and log them", () => {
  const box = sandbox();
  cli(box, "lay", "Use tabs", "--id", "tabs");
  const r = cli(box, "crack", "tabs", "--quote", "no, spaces", "--note", "the team uses spaces", "--harness", "claude");
  assert.equal(r.status, 0, r.stderr);
  const story = cli(box, "history", "tabs").stdout;
  assert.match(story, /💥 cracked v1  claude\n {12}"no, spaces"\n {12}why {5}the team uses spaces\n {12}trials {2}✓0 ✗0 \(v1\)\n\nno trials {2}· {2}0 evolves\n/);
  assert.ok(existsSync(join(box.basket, "cracked", "tabs.history.md")));
});

test("the first write moves a legacy basket's history into history files, with hatches from git, in its own commit", () => {
  const box = sandbox();
  cli(box, "render"); // scaffold the basket
  mkdirSync(join(box.basket, "eggs"), { recursive: true });
  const legacy = (id: string, tier: string): string =>
    `---\nid: ${id}\nkind: preference\ntags: \nharnesses: claude\ngood: 1\nbad: 0\nlaid: 2026-10-01\nupdated: 2026-10-02\n---\n${id} rule\n\n` +
    `## Origin\n\n> my words\n\n- 2026-10-01 · claude · grover\n\n## Trials\n\n- 2026-10-02 ✓ (claude) worked\n`;
  writeFileSync(join(box.basket, "eggs", "old.md"), legacy("old", "egg"));
  git(box, box.basket, "add", "-A");
  git(box, box.basket, "commit", "-q", "-m", "egg: lay old");
  // hatched by an older deveggs: the file moved, nothing recorded the hatch in it
  mkdirSync(join(box.basket, "chickens"), { recursive: true });
  git(box, box.basket, "mv", "eggs/old.md", "chickens/old.md");
  git(box, box.basket, "commit", "-q", "-m", "chicken: hatch old");

  const r = cli(box, "lay", "New rule", "--id", "fresh");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /moved the history of 1 item/);
  assert.deepEqual(subjects(box).slice(0, 2), ["egg: lay fresh", "history: move origin, evolution and trials of 1 item into history files"]);
  assert.equal(readFileSync(join(box.basket, "chickens", "old.md"), "utf8").split("---\n")[2]?.trim(), "old rule");
  const story = cli(box, "history", "old").stdout;
  assert.match(story, /🥚 laid v1  claude · grover\n {12}"my words"/);
  assert.match(story, /✓ trial v1  claude\n {12}note  worked/);
  assert.match(story, /🐣 hatched v1\n {12}trials {2}✓1 ✗0 \(v1\)/);
  assert.match(cli(box, "migrate").stdout, /every item already keeps its history/);
});
