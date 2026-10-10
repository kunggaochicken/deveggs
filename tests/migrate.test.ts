import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hasContent, lnCommand } from "../src/migrate.ts";
import { cli, git, type Sandbox, sandbox, subjects } from "./sandbox.ts";

const EGG = "---\nid: never-push-to-main\nkind: preference\ntags: git\nharnesses: \ngood: 0\nbad: 0\nlaid: 2026-10-01\nupdated: 2026-10-01\n---\nNever push to main\n";

/** An old-style basket inside the checkout, optionally its own git repo, with one skill. */
function legacyBasket(box: Sandbox, withGit: boolean): string {
  const old = join(box.checkout, "my-basket");
  for (const d of ["eggs", "chickens", "cracked", "scripts", "skills/eggs", "skills/chickens/tidy"]) {
    mkdirSync(join(old, d), { recursive: true });
  }
  writeFileSync(join(old, "eggs", ".gitkeep"), "");
  writeFileSync(join(old, "eggs", "never-push-to-main.md"), EGG);
  writeFileSync(join(old, "skills", "chickens", "tidy", "SKILL.md"), "---\nname: tidy\n---\n");
  writeFileSync(join(old, "PREFERENCES.md"), "# Developer preferences\n");
  if (withGit) {
    git(box, old, "init", "-q", "-b", "main");
    git(box, old, "add", "-A");
    git(box, old, "commit", "-q", "-m", "old basket history");
  }
  return old;
}

function skillLink(box: Sandbox, harness: string, name: string, to: string): string {
  const dir = join(box.home, harness, "skills");
  mkdirSync(dir, { recursive: true });
  symlinkSync(to, join(dir, name));
  return join(dir, name);
}

test("hasContent ignores scaffolding and the generated PREFERENCES.md", () => {
  const box = sandbox();
  const root = join(box.dir, "b");
  mkdirSync(join(root, "skills", "eggs"), { recursive: true });
  writeFileSync(join(root, "skills", "eggs", ".gitkeep"), "");
  writeFileSync(join(root, "PREFERENCES.md"), "x");
  writeFileSync(join(root, "README.md"), "x");
  assert.equal(hasContent(root), false);
  assert.equal(hasContent(join(box.dir, "missing")), false);
  writeFileSync(join(root, "skills", "eggs", "SKILL.md"), "x");
  assert.equal(hasContent(root), true);
});

test("migrate moves a nested-git basket with its history and prints relink commands", () => {
  const box = sandbox();
  const old = legacyBasket(box, true);
  const claude = skillLink(box, ".claude", "tidy", join(old, "skills", "chickens", "tidy"));
  const deveggs = skillLink(box, ".codex", "deveggs", join(box.checkout, "skills", "deveggs"));
  writeFileSync(join(box.home, ".claude", "CLAUDE.md"), `Read ${old}/PREFERENCES.md at session start.\n`);

  const list = cli(box, "list");
  assert.match(list.stderr, /your basket is still in .*my-basket; move it to .*basket with: deveggs migrate/);

  const out = cli(box, "migrate");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /moved .*my-basket -> .*basket \(with its git history\)/);
  assert.equal(existsSync(old), false);
  assert.ok(existsSync(join(box.basket, "eggs", "never-push-to-main.md")));
  assert.ok(existsSync(join(box.basket, "README.md")), "README seeded");
  assert.deepEqual(subjects(box), ["history: move origin, evolution and trials of 1 item into history files", "basket: migrate from my-basket/", "old basket history"]);
  assert.equal(git(box, box.basket, "status", "--porcelain"), "");
  const fixed = join(box.basket, "skills", "chickens", "tidy");
  assert.ok(out.stdout.includes(`  ln -sfn ${fixed} ${claude}`), out.stdout);
  assert.ok(!out.stdout.includes(deveggs), "links into the deveggs code are left alone");
  assert.match(out.stdout, /CLAUDE\.md still mentions .*my-basket; point it at .*basket/);
  assert.equal(readlinkSync(claude), join(old, "skills", "chickens", "tidy"), "no relink without --relink");

  const after = cli(box, "list");
  assert.doesNotMatch(after.stderr, /deveggs migrate/);
  assert.match(after.stdout, /never-push-to-main/);

  const relinked = cli(box, "migrate", "--relink");
  assert.equal(relinked.status, 0, relinked.stderr);
  assert.match(relinked.stdout, /nothing to migrate/);
  assert.ok(relinked.stdout.includes(`relinked ${claude} -> ${fixed}`));
  assert.equal(readlinkSync(claude), fixed);
  assert.equal(readlinkSync(deveggs), join(box.checkout, "skills", "deveggs"));
  assert.doesNotMatch(cli(box, "migrate").stdout, /ln -sfn|relinked/);
});

test("migrate makes a plain basket a new git repo, replacing an empty scaffold", () => {
  const box = sandbox();
  cli(box, "render"); // a write before migrating scaffolds an empty basket
  assert.deepEqual(subjects(box), ["render", "basket: create"]);
  legacyBasket(box, false);
  const out = cli(box, "migrate", "--relink");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\(new git repo\)/);
  assert.doesNotMatch(out.stdout, /set .* aside/);
  assert.deepEqual(subjects(box), ["history: move origin, evolution and trials of 1 item into history files", "basket: migrate from my-basket/"]);
  for (const d of ["chickens", "cracked", "scripts", "skills/eggs"]) assert.ok(existsSync(join(box.basket, d)), d);
  assert.equal(git(box, box.basket, "branch", "--show-current"), "main");
});

test("migrate sets aside, never deletes, an empty basket that already has a remote", () => {
  const box = sandbox();
  cli(box, "render");
  git(box, box.basket, "remote", "add", "origin", "https://github.com/tester/my-basket.git");
  legacyBasket(box, true);
  const out = cli(box, "migrate");
  assert.equal(out.status, 0, out.stderr);
  const aside = /aside: (\S+)/.exec(out.stdout)?.[1] ?? "";
  assert.match(aside, /basket\.before-migrate-\d{14}$/);
  assert.ok(existsSync(join(aside, ".git")));
  assert.ok(existsSync(join(box.basket, "eggs", "never-push-to-main.md")));
});

test("migrate refuses when both baskets hold content", () => {
  const box = sandbox();
  cli(box, "lay", "Use tabs");
  const old = legacyBasket(box, true);
  const out = cli(box, "migrate");
  assert.equal(out.status, 1);
  assert.match(out.stderr, /both .*my-basket and .*basket hold a basket; refusing to merge them/);
  assert.ok(existsSync(join(old, "eggs", "never-push-to-main.md")));
  assert.ok(existsSync(join(box.basket, "eggs", "use-tabs.md")));
  assert.doesNotMatch(cli(box, "list").stderr, /deveggs migrate/, "no hint once the new basket has content");
});

test("migrate with nothing to move says so", () => {
  const box = sandbox();
  const out = cli(box, "migrate");
  assert.equal(out.status, 0);
  assert.match(out.stdout, /nothing to migrate/);
  assert.equal(existsSync(box.basket), false);
});

test("lnCommand quotes paths that need it", () => {
  assert.equal(lnCommand({ link: "/h/.claude/skills/x", from: "/old", to: "/new/x" }), "ln -sfn /new/x /h/.claude/skills/x");
  assert.equal(lnCommand({ link: "/h/my skills/x", from: "/old", to: "/n'ew" }), "ln -sfn '/n'\\''ew' '/h/my skills/x'");
});


test("rename moves the item, its skill and harness skill links, re-renders PREFERENCES.md and commits", () => {
  const box = sandbox();
  assert.equal(cli(box, "lay", "Ship it checklist", "--id", "ship", "--kind", "skill", "--chicken").status, 0);
  assert.equal(cli(box, "lay", "Watch memory", "--id", "guardian", "--note", "Works with `ship`").status, 0);
  const old = join(box.basket, "skills", "chickens", "ship");
  const claude = skillLink(box, ".claude", "ship", old);
  const other = skillLink(box, ".codex", "ship", join(box.dir, "elsewhere"));

  const out = cli(box, "rename", "ship", "ship-checklist");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /ship-checklist[\s\S]*renamed from ship/);
  assert.match(out.stdout, /updated references in .*guardian\.md/);
  assert.match(out.stdout, /relinked .*\.claude\/skills\/ship -> .*\.claude\/skills\/ship-checklist/);
  assert.ok(!existsSync(claude) && !existsSync(old));
  assert.equal(readlinkSync(join(box.home, ".claude", "skills", "ship-checklist")), join(box.basket, "skills", "chickens", "ship-checklist"));
  assert.equal(readlinkSync(other), join(box.dir, "elsewhere"), "links deveggs didn't make stay");
  const prefs = readFileSync(join(box.basket, "PREFERENCES.md"), "utf8");
  assert.match(prefs, /`ship-checklist`/);
  assert.doesNotMatch(prefs, /`ship`/);
  assert.equal(subjects(box)[0], "chicken: rename ship to ship-checklist");
  assert.match(cli(box, "show", "ship-checklist").stdout, /renamed from {2}ship \(/);
  assert.ok(existsSync(join(box.basket, "chickens", "ship-checklist.history.md")), "the history moves with the item");
  assert.ok(!existsSync(join(box.basket, "chickens", "ship.history.md")));
  const story = cli(box, "history", "ship-checklist").stdout;
  assert.match(story, /🐔 laid v1[\s\S]*fact {2}Ship it checklist[\s\S]*🏷️ renamed ship → ship-checklist/);

  assert.match(cli(box, "rename", "ship", "x").stderr, /nothing in the basket named "ship"/);
  assert.match(cli(box, "rename", "guardian", "ship-checklist").stderr, /already in the basket/);
  assert.match(cli(box, "rename", "guardian").stderr, /usage: deveggs rename <old-id> <new-id>/);
});
