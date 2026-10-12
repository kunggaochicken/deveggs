import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { END, block, parseHarness, readLine, withBlock, withoutBlock } from "../src/install.ts";
import { cli, type Sandbox, sandbox } from "./sandbox.ts";

const BEGIN = "<!-- deveggs:preferences:begin";

// Every CLI test runs in a sandbox HOME: never the developer's real ~/.claude, ~/.codex or ~/.gemini.

const claudeMd = (box: Sandbox): string => join(box.home, ".claude", "CLAUDE.md");
const agentsMd = (box: Sandbox): string => join(box.home, ".codex", "AGENTS.md");
const geminiMd = (box: Sandbox): string => join(box.home, ".gemini", "GEMINI.md");
const read = (file: string): string => readFileSync(file, "utf8");

/** The deveggs prompt INSTALL.md adds, with its read-at-session-start line. */
const section = (prefs: string): string =>
  ["<!-- deveggs:begin -->", "## deveggs", "", "Basket at ~/.deveggs.", readLine(prefs).trimEnd(), "- Use the `deveggs` skill.", "<!-- deveggs:end -->", ""].join("\n");

/** A sandbox with both harnesses installed, the deveggs prompt in each, and one egg laid. */
function wired(): { box: Sandbox; prefs: string; claude: string; codex: string } {
  const box = sandbox();
  const prefs = join(box.basket, "PREFERENCES.md");
  mkdirSync(join(box.home, ".claude"));
  mkdirSync(join(box.home, ".codex"));
  const claude = `# Mine\n\n@RTK.md\n\n${section(prefs)}`;
  const codex = `Codex notes.\n\n${section(prefs)}`;
  writeFileSync(claudeMd(box), claude);
  writeFileSync(agentsMd(box), codex);
  assert.equal(cli(box, "lay", "Use tabs").status, 0);
  return { box, prefs, claude, codex };
}

test("install imports PREFERENCES.md into Claude Code in place of the read line", () => {
  const { box, prefs } = wired();
  const r = cli(box, "install", "--harness", "claude-code");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claude-code: .*CLAUDE\.md\n\s+installed: imports .*PREFERENCES\.md; replaced the read-at-session-start line/);
  const text = read(claudeMd(box));
  assert.match(text, /<!-- deveggs:preferences:begin \(managed by deveggs install; undo with deveggs uninstall\) state=[A-Za-z0-9+/=]+ -->\n/);
  assert.ok(text.includes(`\n@${prefs}\n${END}\n- Use the \`deveggs\` skill.\n<!-- deveggs:end -->`), text);
  assert.ok(!text.includes("at session start"), "the read line is replaced");
  assert.ok(text.startsWith("# Mine\n\n@RTK.md\n\n<!-- deveggs:begin -->"), "the rest of the file is untouched");
  assert.equal(read(agentsMd(box)).includes(BEGIN), false, "--harness claude-code leaves Codex alone");
});

test("install is idempotent", () => {
  const { box } = wired();
  cli(box, "install");
  const once = [read(claudeMd(box)), read(agentsMd(box))];
  const again = cli(box, "install");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout.match(/already installed; nothing changed/g)?.length, 2, again.stdout);
  assert.deepEqual([read(claudeMd(box)), read(agentsMd(box))], once);
  assert.equal(read(claudeMd(box)).split(BEGIN).length, 2, "one block, not two");
});

test("install copies the preferences inline into Codex, and render keeps them in sync", () => {
  const { box, prefs } = wired();
  const r = cli(box, "install", "--harness", "codex");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /installed: copies .*PREFERENCES\.md inline \(re-synced by deveggs render\)/);
  let text = read(agentsMd(box));
  assert.ok(text.includes("### Developer preferences"), "headings nest under the deveggs section");
  assert.ok(text.includes("`use-tabs`"));
  assert.ok(!text.includes(`@${prefs}`), "Codex has no imports");

  // Every write re-renders, so the copy follows the basket without another install.
  cli(box, "lay", "Never push to main", "--chicken");
  text = read(agentsMd(box));
  assert.ok(text.includes("`never-push-to-main`"), text);
  assert.equal(text.split(BEGIN).length, 2);

  // render says what it synced, and only when something changed.
  writeFileSync(agentsMd(box), text.replace("`use-tabs`", "`stale`"));
  const render = cli(box, "render");
  assert.match(render.stdout, /synced .*AGENTS\.md/);
  assert.equal(read(agentsMd(box)), text);
  assert.doesNotMatch(cli(box, "render").stdout, /synced/);
});

test("render never adds a block that isn't installed", () => {
  const { box, codex } = wired();
  cli(box, "lay", "Use spaces");
  cli(box, "render");
  assert.equal(read(agentsMd(box)), codex);
});

test("inline preferences turn basket-relative links absolute", () => {
  const managed = block("codex", { basket: "/b/PREFERENCES.md" }, "# P\n\n| [x](eggs/x.md#architecture) | [y](https://e.com/y) | [z](/abs/z.md) |\n\n```sh\n# keep [k](k.md)\n```\n\n<!-- deveggs:preferences:end -->\n");
  assert.ok(managed.includes("[x](/b/eggs/x.md#architecture)"), managed);
  assert.ok(managed.includes("[y](https://e.com/y)"));
  assert.ok(managed.includes("[z](/abs/z.md)"));
  assert.ok(managed.includes("### P"));
  assert.ok(managed.includes("```sh\n# keep [k](k.md)\n```"), "code fences are left alone");
  assert.equal(managed.split(END).length, 2, "a marker in the preferences can't end the block");
});

test("--dry-run prints the plan and writes nothing", () => {
  const { box, claude, codex } = wired();
  const r = cli(box, "install", "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would install: imports/);
  assert.match(r.stdout, /would install: copies/);
  assert.match(r.stdout, /\+ @.*PREFERENCES\.md/);
  assert.match(r.stdout, /--dry-run: nothing written\./);
  assert.equal(read(claudeMd(box)), claude);
  assert.equal(read(agentsMd(box)), codex);
});

test("uninstall restores each file exactly", () => {
  const { box, claude, codex } = wired();
  cli(box, "install");
  const dry = cli(box, "uninstall", "--dry-run");
  assert.match(dry.stdout, /would remove the managed block; restored the line it replaced/);
  assert.notEqual(read(claudeMd(box)), claude);
  const r = cli(box, "uninstall");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.match(/removed the managed block; restored the line it replaced/g)?.length, 2, r.stdout);
  assert.equal(read(claudeMd(box)), claude);
  assert.equal(read(agentsMd(box)), codex);
  assert.equal(cli(box, "uninstall").stdout.match(/not installed; nothing changed/g)?.length, 3);
});

test("without a deveggs section the block is appended, and uninstall takes it out", () => {
  const box = sandbox();
  mkdirSync(join(box.home, ".claude"));
  writeFileSync(claudeMd(box), "# Mine\n");
  assert.equal(cli(box, "install", "--harness", "claude-code").status, 0);
  const text = read(claudeMd(box));
  assert.ok(text.startsWith(`# Mine\n\n${BEGIN} `), text);
  assert.ok(existsSync(join(box.basket, "PREFERENCES.md")), "install renders the preferences it loads");
  cli(box, "uninstall", "--harness", "claude-code");
  assert.equal(read(claudeMd(box)), "# Mine\n");
});

test("--harness all skips harnesses that aren't installed; a named one is wired anyway", () => {
  const box = sandbox();
  mkdirSync(join(box.home, ".claude"));
  const all = cli(box, "install");
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /codex: .*\n\s+skipped: not installed \(no ~\/\.codex\)/);
  assert.equal(existsSync(join(box.home, ".codex")), false);
  assert.ok(read(claudeMd(box)).startsWith(BEGIN), "creates a missing CLAUDE.md");
  assert.equal(cli(box, "install", "--harness", "codex").status, 0);
  assert.ok(read(agentsMd(box)).includes(BEGIN));
  const bad = cli(box, "install", "--harness", "cursor");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /invalid --harness "cursor"; expected one of claude-code, codex, gemini, all/);
});

test("a read line outside the deveggs section is left alone", () => {
  const prefs = "/b/PREFERENCES.md";
  const text = `${readLine(prefs)}\n`;
  const out = withBlock(text, "claude-code", prefs, undefined);
  assert.equal(out.where, "appended");
  assert.ok(out.text.startsWith(readLine(prefs)));
  assert.equal(withoutBlock(out.text).text, text);
  assert.deepEqual(parseHarness(undefined), ["claude-code", "codex", "gemini"]);
});

test("uninstall gives back exactly what install replaced or added", () => {
  const prefs = "/b/PREFERENCES.md";
  const cases = [
    // INSTALL.md's own prompt, with ~ rather than the absolute path
    "<!-- deveggs:begin -->\n## deveggs\n- Read `~/.deveggs/PREFERENCES.md` at session start and follow it; it outranks harness-local memory.\n- Use the skill.\n<!-- deveggs:end -->\n",
    // reworded, and the end marker on the same line
    "<!-- deveggs:begin -->\n- Read `~/.deveggs/PREFERENCES.md` at session start, always. <!-- deveggs:end -->",
    "# Mine",
    "# Mine\n\n",
    "<!-- deveggs:begin -->\nno read line\n<!-- deveggs:end -->",
    "",
  ];
  for (const original of cases) {
    for (const harness of ["claude-code", "codex", "gemini"] as const) {
      const installed = withBlock(original, harness, prefs, "# P\n").text;
      assert.equal(withBlock(installed, harness, prefs, "# P\n").text, installed, `idempotent: ${JSON.stringify(original)}`);
      assert.equal(withoutBlock(installed).text, original, `round trip: ${JSON.stringify(original)}`);
    }
  }
  const sameLine = withBlock(cases[1] ?? "", "claude-code", prefs, undefined).text;
  assert.ok(sameLine.endsWith(`${END}\n<!-- deveggs:end -->`), sameLine);
});

test("uninstall deletes an instructions file that install created", () => {
  const box = sandbox();
  mkdirSync(join(box.home, ".claude"));
  cli(box, "install", "--harness", "claude-code");
  assert.ok(existsSync(claudeMd(box)));
  const r = cli(box, "uninstall", "--harness", "claude-code");
  assert.match(r.stdout, /deleted the file it created/);
  assert.equal(existsSync(claudeMd(box)), false);
});

test("a write to another basket never overwrites the installed copy", () => {
  const { box } = wired();
  cli(box, "install", "--harness", "codex");
  const installed = read(agentsMd(box));
  const scratch = { ...box, env: { ...box.env, DEVEGGS_BASKET: join(box.dir, "scratch") } };
  assert.equal(cli(scratch, "lay", "Scratch only").status, 0);
  assert.doesNotMatch(cli(scratch, "render").stdout, /synced/);
  assert.equal(read(agentsMd(box)), installed);
});

test("--dry-run previews what the basket would render, even before PREFERENCES.md exists", () => {
  const { box } = wired();
  rmSync(join(box.basket, "PREFERENCES.md"));
  const r = cli(box, "install", "--harness", "codex", "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /isn't rendered yet/);
  assert.equal(existsSync(join(box.basket, "PREFERENCES.md")), false, "a dry run writes nothing");
});

test("install copies the preferences inline into ~/.gemini/GEMINI.md, for Gemini CLI and Antigravity alike", () => {
  const box = sandbox();
  const prefs = join(box.basket, "PREFERENCES.md");
  mkdirSync(join(box.home, ".gemini"));
  // A hand-written deveggs prompt with no trailing newline, as on a real machine.
  const original = section(prefs).trimEnd();
  writeFileSync(geminiMd(box), original);
  assert.equal(cli(box, "lay", "Use tabs").status, 0);
  const r = cli(box, "install");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /gemini: .*GEMINI\.md\n\s+installed: copies .*PREFERENCES\.md inline \(re-synced by deveggs render\); replaced the read-at-session-start line/);
  let text = read(geminiMd(box));
  assert.ok(text.includes("`use-tabs`"), text);
  assert.ok(!text.includes(`@${prefs}`), "an @import of a path outside ~/.gemini wouldn't load");
  assert.ok(text.endsWith(`${END}\n- Use the \`deveggs\` skill.\n<!-- deveggs:end -->`), text);
  assert.equal(cli(box, "install").stdout.match(/already installed; nothing changed/g)?.length, 1, "idempotent");

  cli(box, "lay", "Never push to main", "--chicken");
  text = read(geminiMd(box));
  assert.ok(text.includes("`never-push-to-main`"), "render re-syncs the Gemini copy");
  assert.equal(text.split(BEGIN).length, 2);

  const u = cli(box, "uninstall", "--harness", "gemini");
  assert.match(u.stdout, /removed the managed block; restored the line it replaced/);
  assert.equal(read(geminiMd(box)), original);
});

test("inline Gemini preferences can't trigger an @import; other harnesses keep the text as is", () => {
  const rendered = "# P\n\n- see @notes.md and @./x.md, @[label](/y.md); mail me@example.com\n\n```sh\n@keep.md\n```\n";
  const gemini = block("gemini", { basket: "/b/PREFERENCES.md" }, rendered);
  assert.doesNotMatch(gemini.replace(/```sh\n@keep\.md/, ""), /(^|\s)@[./A-Za-z[]/m, gemini);
  assert.ok(gemini.includes("me@example.com"));
  assert.ok(gemini.includes("```sh\n@keep.md\n```"), "code fences are left alone");
  assert.ok(block("codex", { basket: "/b/PREFERENCES.md" }, rendered).includes(" @notes.md"));
});

test("install --harness all tells a Cursor user where its global rules go", () => {
  const box = sandbox();
  mkdirSync(join(box.home, ".claude"));
  assert.doesNotMatch(cli(box, "install").stdout, /cursor/);
  mkdirSync(join(box.home, ".cursor"));
  const all = cli(box, "install", "--harness", "all");
  assert.equal(all.status, 0, all.stderr);
  assert.equal(all.stdout.match(/cursor: no global rules file to write; paste the deveggs prompt .* User Rules/g)?.length, 1, all.stdout);
  assert.equal(existsSync(join(box.home, ".cursor", "rules")), false, "writes nothing under ~/.cursor");
  assert.doesNotMatch(cli(box, "install", "--harness", "claude-code").stdout, /cursor/);
});
