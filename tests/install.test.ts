import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { END, block, parseHarness, readLine, scoutCommand, SCOUT_HOOK_TIMEOUT, withBlock, withoutBlock, withoutScoutHook, withScoutHook } from "../src/install.ts";
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
  assert.equal(again.stdout.match(/already installed; nothing changed/g)?.length, 4, again.stdout);
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
  assert.equal(cli(box, "uninstall").stdout.match(/not installed; nothing changed/g)?.length, 5);
  assert.equal(existsSync(join(box.home, ".claude", "settings.json")), false, "the settings file install created is gone");
  assert.equal(existsSync(join(box.home, ".codex", "hooks.json")), false, "so is the Codex hooks file");
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

test("inline Gemini preferences can't trigger an @import; code and other harnesses keep the text as is", () => {
  const rendered = "# P\n\n- see @notes.md and @./x.md, @[label](/y.md); mail me@example.com\n- run `npm i @scope/pkg`\n  ```sh\n  @indented.md\n  ```\n\n```sh\n@keep.md\n```\n";
  const gemini = block("gemini", { basket: "/b/PREFERENCES.md" }, rendered);
  for (const word of ["@notes.md", "@./x.md", "@[label]"]) assert.ok(gemini.includes(` @\u200b${word.slice(1)}`), `${word} is defused: ${gemini}`);
  assert.ok(gemini.includes("me@example.com"));
  assert.ok(gemini.includes("`npm i @scope/pkg`"), "inline code is left alone");
  assert.ok(gemini.includes("  ```sh\n  @indented.md\n  ```"), "indented fences too");
  assert.ok(gemini.includes("```sh\n@keep.md\n```"), "code fences are left alone");
  assert.equal(block("gemini", { basket: "/b/PREFERENCES.md" }, rendered), gemini, "stable across re-syncs");
  assert.ok(block("codex", { basket: "/b/PREFERENCES.md" }, rendered).includes(" @notes.md"));
  // Install and uninstall stay exact with a defused copy in the block.
  const original = section("/b/PREFERENCES.md");
  const installed = withBlock(original, "gemini", "/b/PREFERENCES.md", rendered).text;
  assert.equal(withBlock(installed, "gemini", "/b/PREFERENCES.md", rendered).text, installed);
  assert.equal(withoutBlock(installed).text, original);
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
  assert.match(cli(box, "install", "--dry-run").stdout, /cursor: no global rules file/);
  assert.doesNotMatch(cli(box, "uninstall").stdout, /cursor/);
});

test("a write to another basket never overwrites the installed Gemini copy", () => {
  const box = sandbox();
  mkdirSync(join(box.home, ".gemini"));
  assert.equal(cli(box, "lay", "Use tabs").status, 0);
  cli(box, "install", "--harness", "gemini");
  const installed = read(geminiMd(box));
  const scratch = { ...box, env: { ...box.env, DEVEGGS_BASKET: join(box.dir, "scratch") } };
  assert.equal(cli(scratch, "lay", "Scratch only").status, 0);
  assert.equal(read(geminiMd(box)), installed);
});

// ── the scout hook in ~/.claude/settings.json ───────────────────────────────────────

const settingsJson = (box: Sandbox): string => join(box.home, ".claude", "settings.json");

/** Settings like a real developer's: other keys, and other tools' UserPromptSubmit and Stop hooks. */
const OTHERS = {
  model: "opus",
  permissions: { allow: ["Bash(git status)"] },
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "~/.orca/agent-hooks/claude-hook.sh", timeout: 10 }] }, { matcher: "", hooks: [{ type: "command", command: "rtk hook" }] }],
    Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
  },
  statusLine: { type: "command", command: "ccstatus" },
};

test("install adds one scout hook to settings.json and leaves every other key and hook as it was", () => {
  const { box } = wired();
  writeFileSync(settingsJson(box), `${JSON.stringify(OTHERS, null, 4)}\n`);
  const r = cli(box, "install", "--harness", "claude-code");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claude-code: .*settings\.json\n\s+installed: scout hook \(hooks\.UserPromptSubmit runs .*bin\/deveggs scout --hook --harness claude-code 2>\/dev\/null \|\| true\); added a UserPromptSubmit hook\n/);
  const text = read(settingsJson(box));
  assert.ok(text.startsWith('{\n    "model"'), "keeps the file's indent");
  const after = JSON.parse(text);
  const command = `${join(box.checkout, "bin", "deveggs")} scout --hook --harness claude-code 2>/dev/null || true`;
  assert.deepEqual(after, {
    ...OTHERS,
    hooks: { ...OTHERS.hooks, UserPromptSubmit: [...OTHERS.hooks.UserPromptSubmit, { hooks: [{ type: "command", command, timeout: SCOUT_HOOK_TIMEOUT }] }] },
  });
  const again = cli(box, "install", "--harness", "claude-code");
  assert.match(again.stdout, /scout hook already installed; nothing changed/);
  assert.equal(read(settingsJson(box)), text, "idempotent");
  const removed = cli(box, "uninstall", "--harness", "claude-code");
  assert.match(removed.stdout, /removed the scout hook\n/);
  assert.deepEqual(JSON.parse(read(settingsJson(box))), OTHERS, "uninstall takes out exactly its own entry");
});

test("install creates settings.json when there is none, and uninstall deletes it again", () => {
  const { box } = wired();
  assert.equal(existsSync(settingsJson(box)), false);
  cli(box, "install", "--harness", "claude-code");
  assert.deepEqual(Object.keys(JSON.parse(read(settingsJson(box)))), ["hooks"]);
  const r = cli(box, "uninstall", "--harness", "claude-code");
  assert.match(r.stdout, /removed the scout hook; deleted the settings\.json it left empty/);
  assert.equal(existsSync(settingsJson(box)), false);
});

test("--dry-run shows the scout hook and writes no settings", () => {
  const { box } = wired();
  writeFileSync(settingsJson(box), JSON.stringify(OTHERS));
  const r = cli(box, "install", "--harness", "claude-code", "--dry-run");
  assert.match(r.stdout, /would install: scout hook/);
  assert.match(r.stdout, /\+ \{"type":"command","command":".*deveggs scout --hook --harness claude-code 2>\/dev\/null \|\| true","timeout":15\}/);
  assert.equal(read(settingsJson(box)), JSON.stringify(OTHERS));
  cli(box, "install", "--harness", "claude-code");
  const dry = cli(box, "uninstall", "--harness", "claude-code", "--dry-run");
  assert.match(dry.stdout, /would remove the scout hook/);
  assert.match(read(settingsJson(box)), /deveggs scout --hook/);
});

test("settings.json that isn't a JSON object is left alone", () => {
  const { box } = wired();
  writeFileSync(settingsJson(box), "{ // comments aren't JSON\n}");
  const r = cli(box, "install", "--harness", "claude-code");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped the scout hook: settings\.json isn't a JSON object/);
  assert.equal(read(settingsJson(box)), "{ // comments aren't JSON\n}");
  assert.match(cli(box, "uninstall", "--harness", "claude-code").stdout, /scout hook not installed; nothing changed/);
});

test("Gemini gets no hook and a note saying why; a skipped Claude Code or Codex gets no hook either", () => {
  const { box } = wired();
  rmSync(join(box.home, ".claude"), { recursive: true });
  rmSync(join(box.home, ".codex"), { recursive: true });
  mkdirSync(join(box.home, ".gemini"));
  const r = cli(box, "install");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /scout hook \(/);
  assert.match(r.stdout, /· gemini: no scout hook yet: Antigravity's PreInvocation hook can add context, but agy -p has no isolated one-shot mode/);
  assert.equal(existsSync(settingsJson(box)), false);
  assert.equal(existsSync(codexHooks(box)), false);
  assert.equal(existsSync(join(box.home, ".gemini", "settings.json")), false);
  assert.doesNotMatch(cli(box, "uninstall").stdout, /gemini: .*settings\.json/, "uninstall never looks for a Gemini hook");
});

test("withScoutHook repoints a moved checkout in place; withoutScoutHook keeps groups shared with other hooks", () => {
  const shared = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "rtk hook" }, { type: "command", command: "/old/deveggs/bin/deveggs scout --hook", timeout: 5 }] }] } };
  const moved = withScoutHook(shared, "/new/bin/deveggs scout --hook");
  assert.ok(moved);
  assert.equal(moved.where, "updated the scout hook");
  assert.deepEqual(moved.settings["hooks"], { UserPromptSubmit: [{ hooks: [{ type: "command", command: "rtk hook" }, { type: "command", command: "/new/bin/deveggs scout --hook", timeout: SCOUT_HOOK_TIMEOUT }] }] });
  assert.equal(shared.hooks.UserPromptSubmit[0]?.hooks[1]?.command, "/old/deveggs/bin/deveggs scout --hook", "the input isn't mutated");
  const out = withoutScoutHook(moved.settings);
  assert.equal(out.removed.length, 1);
  assert.deepEqual(out.settings, { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "rtk hook" }] }] } });
  assert.deepEqual(withoutScoutHook({ a: 1 }), { settings: { a: 1 }, removed: [] });
});

test("scoutCommand names the harness, quotes a checkout path with spaces, and uninstall still finds it", () => {
  assert.equal(scoutCommand("/opt/deveggs", "codex"), "/opt/deveggs/bin/deveggs scout --hook --harness codex 2>/dev/null || true");
  assert.equal(scoutCommand("/opt/deveggs"), "/opt/deveggs/bin/deveggs scout --hook 2>/dev/null || true");
  const quoted = scoutCommand("/Users/me/My Tools/deveggs", "claude-code");
  assert.equal(quoted, "'/Users/me/My Tools/deveggs/bin/deveggs' scout --hook --harness claude-code 2>/dev/null || true");
  assert.equal(withoutScoutHook(withScoutHook({}, quoted)?.settings ?? {}).removed.length, 1);
  // A hook from before --harness existed is found and updated in place.
  const old = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: scoutCommand("/opt/deveggs"), timeout: 15 }] }] } };
  const moved = withScoutHook(old, scoutCommand("/opt/deveggs", "claude-code"));
  assert.equal(moved?.where, "updated the scout hook");
  assert.equal((moved?.settings["hooks"] as { UserPromptSubmit: { hooks: { command: string }[] }[] }).UserPromptSubmit[0]?.hooks[0]?.command, scoutCommand("/opt/deveggs", "claude-code"));
});

test("settings of an unexpected shape are never overwritten", () => {
  for (const settings of [{ hooks: "x" }, { hooks: [] }, { hooks: { UserPromptSubmit: {} } }, { hooks: { UserPromptSubmit: "x" } }]) {
    assert.equal(withScoutHook(settings, "/d/bin/deveggs scout --hook"), undefined, JSON.stringify(settings));
  }
  const { box } = wired();
  const odd = JSON.stringify({ hooks: { UserPromptSubmit: { weird: true } } });
  writeFileSync(settingsJson(box), odd);
  const r = cli(box, "install", "--harness", "claude-code");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped the scout hook: settings\.json hooks or hooks\.UserPromptSubmit has an unexpected shape/);
  assert.match(r.stdout, /installed: imports/, "the CLAUDE.md block still installs");
  assert.equal(read(settingsJson(box)), odd);
});

test("a group without a hooks array is kept, and a look-alike command isn't taken for the scout", () => {
  const settings = {
    hooks: {
      UserPromptSubmit: [
        { matcher: "x" },
        { hooks: [{ type: "command", command: "/x/my-deveggs scout --hook-wrapper" }, { type: "command", command: "/x/notdeveggs scout --hook" }] },
      ],
    },
  };
  assert.deepEqual(withoutScoutHook(settings), { settings, removed: [] });
  const added = withScoutHook(settings, scoutCommand("/d"));
  assert.ok(added);
  assert.equal(added.where, "added a UserPromptSubmit hook");
  assert.deepEqual(withoutScoutHook(added.settings).settings, settings);
});

test("install from a git worktree warns that the hook is pinned to it", () => {
  const { box } = wired();
  writeFileSync(join(box.checkout, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
  const r = cli(box, "install", "--harness", "claude-code");
  assert.match(r.stderr, /the scout hook points into a git worktree/);
  const codex = cli(wiredFromWorktree(), "install", "--harness", "codex");
  assert.match(codex.stderr, /the scout hook points into a git worktree/, "a Codex hook warns too");
});

function wiredFromWorktree(): Sandbox {
  const { box } = wired();
  writeFileSync(join(box.checkout, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
  return box;
}

// ── the scout hook in ~/.codex/hooks.json ───────────────────────────────────────────

const codexHooks = (box: Sandbox): string => join(box.home, ".codex", "hooks.json");

/** hooks.json like a real developer's: other tools' UserPromptSubmit, SessionStart and Stop hooks. */
const CODEX_OTHERS = {
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "bash ~/.codex/herdr-agent-state.sh session", timeout: 10 }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: ": orca-agent-hook-form=1; /bin/sh ~/.orca/agent-hooks/codex-hook.sh || :", timeout: 10 }] }],
    Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
  },
};

test("install adds the Codex scout hook to hooks.json, says to trust it, and uninstall takes out exactly it", () => {
  const { box } = wired();
  writeFileSync(codexHooks(box), `${JSON.stringify(CODEX_OTHERS, null, 2)}\n`);
  const r = cli(box, "install", "--harness", "codex");
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /codex: .*\.codex\/hooks\.json\n\s+installed: scout hook \(hooks\.UserPromptSubmit runs .*bin\/deveggs scout --hook --harness codex 2>\/dev\/null \|\| true\); added a UserPromptSubmit hook\. Codex runs it once you trust it: start codex and review it in \/hooks/,
  );
  assert.match(r.stdout, /in codex, the scout hook names the ones that fit each prompt/);
  const command = `${join(box.checkout, "bin", "deveggs")} scout --hook --harness codex 2>/dev/null || true`;
  const text = read(codexHooks(box));
  assert.deepEqual(JSON.parse(text), {
    hooks: { ...CODEX_OTHERS.hooks, UserPromptSubmit: [...CODEX_OTHERS.hooks.UserPromptSubmit, { hooks: [{ type: "command", command, timeout: 15 }] }] },
  });
  assert.equal(existsSync(settingsJson(box)), false, "--harness codex leaves Claude Code's settings alone");
  const again = cli(box, "install", "--harness", "codex");
  assert.match(again.stdout, /scout hook already installed; nothing changed/);
  assert.doesNotMatch(again.stdout, /trust it/, "nothing changed, so nothing to re-trust");
  assert.equal(read(codexHooks(box)), text, "idempotent");
  const removed = cli(box, "uninstall", "--harness", "codex");
  assert.match(removed.stdout, /codex: .*hooks\.json\n\s+removed the scout hook\n/);
  assert.deepEqual(JSON.parse(read(codexHooks(box))), CODEX_OTHERS, "every other hook is kept, in order");
});

test("install creates ~/.codex/hooks.json when there is none, and uninstall deletes it again", () => {
  const { box } = wired();
  cli(box, "install", "--harness", "codex");
  assert.deepEqual(Object.keys(JSON.parse(read(codexHooks(box)))), ["hooks"]);
  const r = cli(box, "uninstall", "--harness", "codex");
  assert.match(r.stdout, /removed the scout hook; deleted the hooks\.json it left empty/);
  assert.equal(existsSync(codexHooks(box)), false);
});

test("--dry-run shows the Codex hook line and writes nothing", () => {
  const { box } = wired();
  writeFileSync(codexHooks(box), JSON.stringify(CODEX_OTHERS));
  const r = cli(box, "install", "--dry-run");
  assert.match(r.stdout, /codex: .*hooks\.json\n\s+would install: scout hook \(hooks\.UserPromptSubmit runs .*--harness codex/);
  assert.match(r.stdout, /\+ \{"type":"command","command":".*deveggs scout --hook --harness codex 2>\/dev\/null \|\| true","timeout":15\}/);
  assert.equal(read(codexHooks(box)), JSON.stringify(CODEX_OTHERS));
  assert.equal(existsSync(settingsJson(box)), false);
});

test("a Codex hooks.json that isn't a JSON object, or has an odd shape, is left alone", () => {
  for (const odd of ["not json", JSON.stringify({ hooks: { UserPromptSubmit: { x: 1 } } })]) {
    const { box } = wired();
    writeFileSync(codexHooks(box), odd);
    const r = cli(box, "install", "--harness", "codex");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skipped the scout hook: hooks\.json (isn't a JSON object|hooks or hooks\.UserPromptSubmit has an unexpected shape)/);
    assert.match(r.stdout, /installed: copies/, "the AGENTS.md block still installs");
    assert.equal(read(codexHooks(box)), odd);
  }
});

test("install without --harness wires both hooks, each naming its own harness", () => {
  const { box } = wired();
  assert.equal(cli(box, "install").status, 0);
  assert.match(read(settingsJson(box)), /scout --hook --harness claude-code/);
  assert.match(read(codexHooks(box)), /scout --hook --harness codex/);
  assert.doesNotMatch(read(settingsJson(box)), /--harness codex/);
});
