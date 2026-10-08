import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, fakePath, git, type Sandbox, sandbox } from "./sandbox.ts";

// Every test uses a temp basket and a local bare repo as origin: no network, no gh.

/** A sandbox whose basket has one egg and a local bare repo as origin, already pushed. */
function withOrigin(): { box: Sandbox; bare: string } {
  const box = sandbox();
  box.env["PATH"] = fakePath(box, {}); // no gh anywhere
  cli(box, "lay", "Never push to main");
  const bare = join(box.dir, "remote.git");
  git(box, box.dir, "init", "-q", "--bare", bare);
  git(box, box.basket, "remote", "add", "origin", bare);
  assert.equal(cli(box, "push").status, 0);
  return { box, bare };
}

const remoteHead = (box: Sandbox, bare: string): string => git(box, bare, "log", "-1", "--format=%s", "main");

test("autopush is off by default and status says where it would push", () => {
  const empty = sandbox();
  const none = cli(empty, "autopush", "status");
  assert.equal(none.status, 0, none.stderr);
  assert.equal(none.stdout.trim(), "autopush off (no remote yet; save the basket with: deveggs push)");

  const { box, bare } = withOrigin();
  const status = cli(box, "autopush", "status");
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout.trim(), `autopush off (remote: ${bare.replace(/\.git$/, "")})`);
});

test("autopush on needs a remote and creates nothing without one", () => {
  const box = sandbox();
  box.env["PATH"] = fakePath(box, {});
  const noBasket = cli(box, "autopush", "on");
  assert.equal(noBasket.status, 1);
  assert.match(noBasket.stderr, /autopush needs your basket on GitHub first; run deveggs push, then deveggs autopush on/);
  cli(box, "lay", "Never push to main");
  const noRemote = cli(box, "autopush", "on");
  assert.equal(noRemote.status, 1);
  assert.match(noRemote.stderr, /run deveggs push, then deveggs autopush on/);
  assert.equal(cli(box, "autopush", "status").stdout.trim(), "autopush off (no remote yet; save the basket with: deveggs push)");
  assert.equal(cli(box, "autopush", "off").status, 0, "off without a remote is a no-op");
  assert.match(cli(box, "autopush", "sideways").stderr, /usage: deveggs autopush on\|off\|status/);
});

test("autopush on stores the setting in the basket's git config and pushes every write", () => {
  const { box, bare } = withOrigin();
  const on = cli(box, "autopush", "on");
  assert.equal(on.status, 0, on.stderr);
  assert.equal(on.stdout.trim(), `autopush on (pushes: ${bare.replace(/\.git$/, "")})`);
  assert.equal(git(box, box.basket, "config", "--get", "deveggs.autopush"), "true");
  assert.equal(git(box, box.basket, "status", "--porcelain"), "", "no new files");

  const lay = cli(box, "lay", "Use tabs");
  assert.equal(lay.status, 0, lay.stderr);
  assert.equal(lay.stderr, "");
  assert.equal(remoteHead(box, bare), "egg: lay use-tabs");
  cli(box, "feedback", "use-tabs", "--good");
  assert.equal(remoteHead(box, bare), "trial: good use-tabs");
  cli(box, "hatch", "use-tabs");
  assert.equal(remoteHead(box, bare), "chicken: hatch use-tabs");
  assert.equal(git(box, box.basket, "rev-parse", "HEAD"), git(box, bare, "rev-parse", "main"));
});

test("autopush off stops pushing; commits stay local", () => {
  const { box, bare } = withOrigin();
  cli(box, "autopush", "on");
  const off = cli(box, "autopush", "off");
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, /^autopush off \(remote: /);
  assert.equal(cli(box, "autopush", "off").status, 0, "off twice is fine");
  const before = remoteHead(box, bare);
  const lay = cli(box, "lay", "Use tabs");
  assert.equal(lay.status, 0, lay.stderr);
  assert.equal(remoteHead(box, bare), before);
  assert.equal(git(box, box.basket, "log", "-1", "--format=%s"), "egg: lay use-tabs");
});

test("with autopush off (the default) writes never push", () => {
  const { box, bare } = withOrigin();
  const before = remoteHead(box, bare);
  cli(box, "lay", "Use tabs");
  cli(box, "render");
  assert.equal(remoteHead(box, bare), before);
});

test("a failed autopush warns in one line and the command still succeeds", () => {
  const { box, bare } = withOrigin();
  cli(box, "autopush", "on");
  rmSync(bare, { recursive: true, force: true }); // the remote is gone: like being offline
  const lay = cli(box, "lay", "Use tabs");
  assert.equal(lay.status, 0, lay.stderr);
  assert.match(lay.stdout, /🥚 use-tabs/);
  const lines = lay.stderr.trim().split("\n");
  assert.equal(lines.length, 1, lay.stderr);
  assert.match(
    lines[0] ?? "",
    /^deveggs: warning: autopush failed \(.+\); your basket is committed locally\. Run deveggs push later\.$/,
  );
  assert.equal(git(box, box.basket, "log", "-1", "--format=%s"), "egg: lay use-tabs");
  assert.equal(git(box, box.basket, "status", "--porcelain"), "");
});

test("autopush skips the push when a write changes nothing", () => {
  const { box, bare } = withOrigin();
  cli(box, "autopush", "on");
  rmSync(bare, { recursive: true, force: true });
  const render = cli(box, "render"); // nothing new to commit, so nothing to push
  assert.equal(render.status, 0);
  assert.equal(render.stderr, "");
});
