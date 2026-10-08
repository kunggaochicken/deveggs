import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { basketPath, webUrl } from "../src/store.ts";
import { cli, fakePath, git, repoRoot, sandbox, subjects } from "./sandbox.ts";

test("the basket is $DEVEGGS_BASKET, else ~/.deveggs", () => {
  assert.equal(basketPath({ DEVEGGS_BASKET: "/tmp/elsewhere/basket" }), "/tmp/elsewhere/basket");
  assert.equal(basketPath({}), join(homedir(), ".deveggs"));
  const box = sandbox();
  delete box.env["DEVEGGS_BASKET"];
  const where = cli(box, "where");
  assert.equal(where.status, 0);
  assert.equal(where.stdout.trim(), join(box.env["HOME"] ?? "", ".deveggs"));
  assert.equal(existsSync(where.stdout.trim()), false, "where creates nothing");
});

test("read-only commands on a missing basket say where it would live and create nothing", () => {
  const box = sandbox();
  const list = cli(box, "list");
  assert.equal(list.status, 0);
  assert.match(list.stdout, /basket is empty; it will live at .*basket/);
  const show = cli(box, "show", "nope");
  assert.equal(show.status, 1);
  assert.match(show.stderr, /nothing in the basket named "nope"; basket is empty/);
  const feedback = cli(box, "feedback", "nope", "--good");
  assert.equal(feedback.status, 1);
  assert.equal(existsSync(box.basket), false);
});

test("the first write scaffolds the basket, seeds its README and makes it a git repo", () => {
  const box = sandbox();
  const lay = cli(box, "lay", "Never push to main", "--tag", "git");
  assert.equal(lay.status, 0, lay.stderr);
  assert.equal(lay.stderr, "");
  assert.match(lay.stdout, /started your basket at .*basket \(its own git repo; save it to GitHub with: deveggs push\)/);
  assert.match(lay.stdout, /🥚 never-push-to-main/);
  for (const dir of ["eggs", "chickens", "cracked", "scripts", "skills/eggs", "skills/chickens"]) {
    assert.ok(existsSync(join(box.basket, dir, ".gitkeep")), dir);
  }
  assert.equal(
    readFileSync(join(box.basket, "README.md"), "utf8"),
    readFileSync(join(repoRoot, "templates", "basket-README.md"), "utf8"),
  );
  assert.ok(existsSync(join(box.basket, "eggs", "never-push-to-main.md")));
  assert.equal(git(box, box.basket, "branch", "--show-current"), "main");
  assert.deepEqual(subjects(box), ["egg: lay never-push-to-main", "basket: create"]);
  assert.equal(git(box, box.basket, "status", "--porcelain"), "", "everything committed");
  assert.doesNotMatch(cli(box, "lay", "Use tabs").stdout, /started your basket/);
});

test("every write is committed with a message naming what changed", () => {
  const box = sandbox();
  cli(box, "lay", "Never push to main");
  cli(box, "lay", "Use tabs");
  cli(box, "lay", "Prefer small PRs", "--chicken");
  cli(box, "feedback", "never-push-to-main", "--good");
  cli(box, "feedback", "never-push-to-main", "--bad", "--note", "too strict");
  cli(box, "hatch", "never-push-to-main");
  cli(box, "crack", "use-tabs");
  writeFileSync(join(box.basket, "scripts", "x.sh"), "echo hi\n");
  cli(box, "render");
  cli(box, "render"); // nothing changed: no empty commit
  assert.deepEqual(subjects(box), [
    "render",
    "crack: use-tabs",
    "chicken: hatch never-push-to-main",
    "trial: bad never-push-to-main",
    "trial: good never-push-to-main",
    "chicken: lay prefer-small-prs",
    "egg: lay use-tabs",
    "egg: lay never-push-to-main",
    "basket: create",
  ]);
  const list = cli(box, "list");
  assert.match(list.stdout, /never-push-to-main/);
  assert.equal(list.stderr, "");
});

test("without git the command still works and warns once per write", () => {
  const box = sandbox();
  box.env["PATH"] = fakePath(box, {}, false);
  const lay = cli(box, "lay", "Never push to main");
  assert.equal(lay.status, 0, lay.stderr);
  assert.match(lay.stderr, /^deveggs: warning: git not found; your basket isn't version-controlled/);
  assert.equal(lay.stderr.trim().split("\n").length, 1);
  assert.ok(existsSync(join(box.basket, "eggs", "never-push-to-main.md")));
  assert.equal(existsSync(join(box.basket, ".git")), false);
  const fb = cli(box, "feedback", "never-push-to-main", "--good");
  assert.equal(fb.status, 0);
  assert.equal(fb.stderr.trim().split("\n").length, 1);
});

test("a commit that fails for want of a git identity warns and keeps the change", () => {
  const box = sandbox("[user]\n\tuseConfigOnly = true\n");
  const lay = cli(box, "lay", "Never push to main");
  assert.equal(lay.status, 0, lay.stderr);
  assert.match(lay.stderr, /deveggs: warning: basket change not committed: git has no identity/);
  assert.ok(existsSync(join(box.basket, "eggs", "never-push-to-main.md")));
  assert.ok(existsSync(join(box.basket, ".git")));
});

const FAKE_GH = `echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "auth status") exit "\${GH_AUTH:-0}" ;;
  "repo create")
    case "$3" in */*) name="$3" ;; *) name="tester/$3" ;; esac
    git -C "$6" remote add origin "https://github.com/$name.git"
    echo "https://github.com/$name" ;;
esac`;

test("push creates a private GitHub repo with gh the first time", () => {
  const box = sandbox();
  box.env["PATH"] = fakePath(box, { gh: FAKE_GH });
  box.env["GH_LOG"] = join(box.dir, "gh.log");
  cli(box, "lay", "Never push to main");
  const push = cli(box, "push", "--repo", "tester/basket");
  assert.equal(push.status, 0, push.stderr);
  assert.match(push.stdout, /basket saved to https:\/\/github.com\/tester\/basket$/m);
  const calls = readFileSync(box.env["GH_LOG"], "utf8").trim().split("\n");
  assert.deepEqual(calls.slice(-1), [`repo create tester/basket --private --source ${box.basket} --remote origin --push`]);
  assert.ok(calls.includes("auth status"));
});

test("push defaults the new repo's name to my-basket and creates the basket if needed", () => {
  const box = sandbox();
  box.env["PATH"] = fakePath(box, { gh: FAKE_GH });
  box.env["GH_LOG"] = join(box.dir, "gh.log");
  const push = cli(box, "push");
  assert.equal(push.status, 0, push.stderr);
  assert.match(push.stdout, /basket saved to https:\/\/github.com\/tester\/my-basket$/m);
  assert.deepEqual(subjects(box), ["basket: create"]);
});

test("push explains what's missing when gh isn't installed or logged in", () => {
  const box = sandbox();
  box.env["PATH"] = fakePath(box, {});
  const noGh = cli(box, "push");
  assert.equal(noGh.status, 1);
  assert.match(noGh.stderr, /needs the gh CLI \(https:\/\/cli.github.com\), or add a remote yourself: git -C .* remote add origin <url>/);

  const box2 = sandbox();
  box2.env["PATH"] = fakePath(box2, { gh: FAKE_GH });
  box2.env["GH_LOG"] = join(box2.dir, "gh.log");
  box2.env["GH_AUTH"] = "1";
  const noAuth = cli(box2, "push");
  assert.equal(noAuth.status, 1);
  assert.match(noAuth.stderr, /gh isn't logged in; run gh auth login/);
  assert.doesNotMatch(readFileSync(box2.env["GH_LOG"], "utf8"), /repo create/);

  const bad = cli(box2, "push", "--repo", "a b");
  assert.match(bad.stderr, /invalid --repo "a b"/);
});

test("push with an origin is a plain git push, and saves uncommitted edits first", () => {
  const box = sandbox();
  box.env["PATH"] = fakePath(box, {}); // no gh: it must not be needed
  cli(box, "lay", "Never push to main");
  const bare = join(box.dir, "remote.git");
  git(box, box.dir, "init", "-q", "--bare", bare);
  git(box, box.basket, "remote", "add", "origin", bare);
  writeFileSync(join(box.basket, "scripts", "hand-made.sh"), "echo hi\n");
  const push = cli(box, "push");
  assert.equal(push.status, 0, push.stderr);
  assert.match(push.stdout, new RegExp(`basket saved to ${bare.replace(/\.git$/, "")}$`, "m"));
  assert.equal(git(box, bare, "log", "-1", "--format=%s", "main"), "basket: save");
  const again = cli(box, "push", "--repo", "tester/other");
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already pushes to .*--repo only names a new repo/);
});

test("webUrl turns git remotes into browsable URLs", () => {
  assert.equal(webUrl("git@github.com:me/my-basket.git"), "https://github.com/me/my-basket");
  assert.equal(webUrl("https://github.com/me/my-basket.git"), "https://github.com/me/my-basket");
  assert.equal(webUrl("ssh://git@github.com/me/my-basket.git"), "https://github.com/me/my-basket");
  assert.equal(webUrl("/srv/basket.git"), "/srv/basket");
});
