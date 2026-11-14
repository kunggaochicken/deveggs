import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, repoRoot, sandbox } from "./sandbox.ts";

// `deveggs lease` and `deveggs mem` run the basket's own scripts/lease and scripts/mem.

const shim = join(repoRoot, "bin", "deveggs");

function withScripts(): ReturnType<typeof sandbox> {
  const box = sandbox();
  mkdirSync(join(box.basket, "scripts"), { recursive: true });
  for (const name of ["lease", "mem"]) {
    writeFileSync(join(box.basket, "scripts", name), `echo "${name}:$#:$*"; exit 3\n`);
  }
  return box;
}

test("bin/deveggs execs the basket's script with every argument, flags included, and its exit status", () => {
  const box = withScripts();
  for (const name of ["lease", "mem"]) {
    const r = spawnSync(shim, [name, "--label", "x y", "--", "pnpm", "typecheck"], { env: box.env, encoding: "utf8" });
    assert.equal(r.status, 3, r.stderr);
    assert.equal(r.stdout.trim(), `${name}:5:--label x y -- pnpm typecheck`);
  }
});

test("the CLI runs them too when called without the shim", () => {
  const box = withScripts();
  const r = cli(box, "mem", "status");
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.stdout.trim(), "mem:1:status");
});

test("a basket without the script says so", () => {
  const box = sandbox();
  const r = spawnSync(shim, ["lease", "--", "true"], { env: box.env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lease runs your basket's scripts\/lease, and .* has none/);
  const c = cli(box, "mem", "status");
  assert.equal(c.status, 1);
  assert.match(c.stderr, /mem runs your basket's scripts\/mem, and .* has none/);
});

test("a signal ends the command with 128+n, through the shim and without it", () => {
  const box = sandbox();
  mkdirSync(join(box.basket, "scripts"), { recursive: true });
  writeFileSync(join(box.basket, "scripts", "lease"), "kill -TERM $$\n");
  const r = spawnSync(shim, ["lease"], { env: box.env, encoding: "utf8" });
  assert.equal(r.signal, "SIGTERM");
  assert.equal(cli(box, "lease").status, 143);
});

test("a relative DEVEGGS_BASKET resolves from the current directory", () => {
  const box = withScripts();
  const r = spawnSync(shim, ["mem", "status"], { env: { ...box.env, DEVEGGS_BASKET: "basket" }, cwd: box.dir, encoding: "utf8" });
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.stdout.trim(), "mem:1:status");
});

test("a folder named like the script is not a script", () => {
  const box = sandbox();
  mkdirSync(join(box.basket, "scripts", "mem"), { recursive: true });
  const c = cli(box, "mem", "status");
  assert.equal(c.status, 1);
  assert.match(c.stderr, /has none/);
});
