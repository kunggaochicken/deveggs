import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { apply, harnesses, planInstall, planUninstall, removeBlock, upsertBlock } from "../src/install.ts";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "deveggs-repo-"));
  const home = mkdtempSync(join(tmpdir(), "deveggs-home-"));
  mkdirSync(join(root, "skills", "deveggs"), { recursive: true });
  writeFileSync(join(root, "skills", "deveggs", "SKILL.md"), "x");
  for (const [tier, name] of [["chickens", "ship-it"], ["eggs", "try-me"], ["eggs", "ship-it"]] as const) {
    mkdirSync(join(root, "basket", "skills", tier, name), { recursive: true });
    writeFileSync(join(root, "basket", "skills", tier, name, "SKILL.md"), "x");
  }
  const [claude] = harnesses(home);
  assert.ok(claude);
  mkdirSync(claude.home, { recursive: true });
  writeFileSync(claude.instructionsFile, "# mine\n\nkeep me\n");
  return { root, claude };
}

test("upsertBlock is idempotent and removeBlock restores the file", () => {
  const once = upsertBlock("# mine\n", "<!-- deveggs:begin -->\nA\n<!-- deveggs:end -->");
  const twice = upsertBlock(once, "<!-- deveggs:begin -->\nB\n<!-- deveggs:end -->");
  assert.equal(twice, "# mine\n\n<!-- deveggs:begin -->\nB\n<!-- deveggs:end -->\n");
  assert.equal(removeBlock(twice), "# mine\n");
});

test("install links skills + writes block; reinstall is a no-op; uninstall reverts", () => {
  const { root, claude } = setup();
  apply(planInstall(root, [claude]));
  assert.equal(readlinkSync(join(claude.skillsDir, "deveggs")), join(root, "skills", "deveggs"));
  // chickens outrank an egg of the same name; eggs on trial are linked too
  assert.equal(readlinkSync(join(claude.skillsDir, "ship-it")), join(root, "basket", "skills", "chickens", "ship-it"));
  assert.equal(readlinkSync(join(claude.skillsDir, "try-me")), join(root, "basket", "skills", "eggs", "try-me"));
  assert.match(readFileSync(claude.instructionsFile, "utf8"), /keep me[\s\S]*deveggs:begin/);
  assert.deepEqual(planInstall(root, [claude]), []);

  apply(planUninstall(root, [claude]));
  assert.equal(existsSync(join(claude.skillsDir, "deveggs")), false);
  assert.equal(readFileSync(claude.instructionsFile, "utf8"), "# mine\n\nkeep me\n");
});

test("install never clobbers a skill it does not own", () => {
  const { root, claude } = setup();
  mkdirSync(join(claude.skillsDir, "deveggs"), { recursive: true });
  const plan = planInstall(root, [claude]);
  assert.ok(plan.some((a) => a.type === "skip" && a.path.endsWith("deveggs")));
});

test("install drops links to skills that were cracked", () => {
  const { root, claude } = setup();
  apply(planInstall(root, [claude]));
  rmSync(join(root, "basket", "skills", "eggs", "try-me"), { recursive: true });
  const plan = planInstall(root, [claude]);
  assert.deepEqual(plan.map((a) => a.type), ["unlink"]);
  apply(plan);
  assert.equal(existsSync(join(claude.skillsDir, "try-me")), false);
});
