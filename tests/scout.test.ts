import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type Egg } from "../src/basket.ts";
import { type Ask, candidates, contextFor, hookOutput, logRun, parseHookInput, parseVerdict, scout, scoutPrompt, transcriptTail } from "../src/scout.ts";
import { cli, fakePath, type Sandbox, sandbox } from "./sandbox.ts";

const egg = (id: string, tier: Egg["tier"], summary: string, when?: string): Egg => ({
  id,
  kind: "preference",
  tier,
  tags: [],
  harnesses: [],
  good: 0,
  bad: 0,
  version: 1,
  laid: "2026-10-01",
  updated: "2026-10-01",
  summary,
  body: when ? `## Architecture\n\n- ⚡ **Fires when:** ${when}\n` : "",
});

const ITEMS = [
  egg("decision-tables", "egg", "Present options as a table", "the developer must choose between options"),
  egg("land-via-pr", "chicken", "Always land changes through a PR", "any change is ready to land"),
  egg("old-habit", "cracked", "Never mind"),
];

const line = (o: unknown): string => JSON.stringify(o);

test("parseHookInput reads Claude Code's UserPromptSubmit JSON, and refuses anything else", () => {
  assert.deepEqual(parseHookInput(line({ prompt: "ship it", transcript_path: "/t.jsonl", cwd: "/r", session_id: "s1", hook_event_name: "UserPromptSubmit" })), {
    prompt: "ship it",
    transcriptPath: "/t.jsonl",
    cwd: "/r",
    sessionId: "s1",
  });
  assert.deepEqual(parseHookInput(line({ prompt: "hi" })), { prompt: "hi" });
  for (const bad of ["", "not json", "[]", line({ prompt: "" }), line({ prompt: 3 }), line({})]) assert.equal(parseHookInput(bad), undefined, bad);
});

test("transcriptTail keeps the last user and assistant text turns, skipping tools, meta and harness noise", () => {
  const jsonl = [
    line({ type: "summary", summary: "x" }),
    line({ type: "user", message: { role: "user", content: "first question" } }),
    line({ type: "assistant", message: { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "first answer" }, { type: "tool_use", name: "Bash" }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", content: "lots of output" }] } }),
    line({ type: "user", isMeta: true, message: { content: "caveat" } }),
    line({ type: "user", message: { content: "<system-reminder>ignore me</system-reminder>second question" } }),
    line({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "subagent chatter" }] } }),
    "{ partial line",
    line({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(2000) }] } }),
  ].join("\n");
  const turns = transcriptTail(jsonl);
  assert.deepEqual(turns.map((t) => t.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(turns[0]?.text, "first question");
  assert.equal(turns[2]?.text, "second question");
  assert.equal(turns[3]?.text.length, 601, "each turn is capped");
  const capped = transcriptTail(jsonl, { total: 700 });
  assert.ok(capped.reduce((n, t) => n + t.text.length, 0) <= 700 || capped.length === 1);
  assert.equal(transcriptTail(jsonl, { turns: 2 }).length, 2);
});

test("candidates are eggs and chickens with their fires-when; cracked items never apply", () => {
  assert.deepEqual(candidates(ITEMS), [
    { id: "decision-tables", tier: "egg", fact: "Present options as a table", when: "the developer must choose between options" },
    { id: "land-via-pr", tier: "chicken", fact: "Always land changes through a PR", when: "any change is ready to land" },
  ]);
  const prompt = scoutPrompt("which db should we use?", [{ role: "user", text: "earlier" }], candidates(ITEMS));
  assert.match(prompt, /- decision-tables \(egg\) \| fires when: the developer must choose between options \| fact: Present options as a table/);
  assert.match(prompt, /<new-request>\nwhich db should we use\?\n<\/new-request>/);
  assert.match(prompt, /\[user\] earlier/);
  assert.doesNotMatch(prompt, /old-habit/);
});

test("parseVerdict keeps only known ids, once each, and finds the JSON inside chatter", () => {
  const known = new Set(["decision-tables", "land-via-pr"]);
  assert.deepEqual(parseVerdict('Sure!\n```json\n{"apply":[{"id":"decision-tables","why":"picking a db"},{"id":"made-up","why":"x"},{"id":"decision-tables","why":"dup"},{"id":"land-via-pr"}]}\n```', known), [
    { id: "decision-tables", why: "picking a db" },
    { id: "land-via-pr", why: "" },
  ]);
  assert.deepEqual(parseVerdict('{"apply":[]}', known), []);
  for (const bad of ["nothing", "{oops}", '{"apply":"all"}', '{"pick":[]}']) assert.equal(parseVerdict(bad, known), undefined, bad);
});

test("the hook output is UserPromptSubmit additionalContext naming each item, its fact and why", () => {
  const items = candidates(ITEMS);
  const context = contextFor([{ id: "decision-tables", why: "picking a db" }], items);
  assert.match(context, /^deveggs scout \(fresh-context check\): these preferences apply to this request/);
  assert.match(context, /- `decision-tables` \(egg\): Present options as a table \(why: picking a db\)/);
  assert.match(context, /deveggs feedback <id> --good\|--bad/, "an egg asks for a trial");
  assert.doesNotMatch(contextFor([{ id: "land-via-pr", why: "" }], items), /deveggs feedback/, "a chicken alone doesn't");
  assert.deepEqual(JSON.parse(hookOutput(context)), { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } });
});

test("scout asks once with the configured model and timeout, and injects what applies", () => {
  const calls: { model: string; timeoutMs: number; prompt: string }[] = [];
  const ask: Ask = (prompt, opts) => {
    calls.push({ prompt, ...opts });
    return { ok: true, text: '{"apply":[{"id":"decision-tables","why":"choosing"},{"id":"ghost","why":"?"}]}' };
  };
  let t = 1000;
  const r = scout({ prompt: "postgres or sqlite?" }, { items: ITEMS, ask, env: { DEVEGGS_SCOUT_MODEL: "sonnet", DEVEGGS_SCOUT_TIMEOUT_MS: "5000" }, now: () => (t += 50) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.model, "sonnet");
  assert.equal(calls[0]?.timeoutMs, 5000);
  assert.deepEqual(r.applied, [{ id: "decision-tables", why: "choosing" }]);
  assert.equal(r.ms, 50);
  assert.equal(r.candidates, 2);
  assert.match(JSON.parse(r.output ?? "{}").hookSpecificOutput.additionalContext, /decision-tables/);
  assert.doesNotMatch(r.output ?? "", /ghost/);
  const defaults = scout({ prompt: "x" }, { items: ITEMS, ask, env: { DEVEGGS_SCOUT_TIMEOUT_MS: "soon" } });
  assert.ok(defaults.output);
  assert.equal(calls[1]?.model, "haiku");
  assert.equal(calls[1]?.timeoutMs, 25000);
});

test("scout fails open: no items, a failed ask, an unparseable or empty verdict, or a throw all print nothing", () => {
  const never: Ask = () => assert.fail("must not ask");
  const cases: [string, ReturnType<typeof scout>][] = [
    ["no items", scout({ prompt: "x" }, { items: [], ask: never, env: {} })],
    ["only cracked", scout({ prompt: "x" }, { items: [ITEMS[2] as Egg], ask: never, env: {} })],
    ["timeout", scout({ prompt: "x" }, { items: ITEMS, ask: () => ({ ok: false, error: "timed out after 25000 ms" }), env: {} })],
    ["garbage", scout({ prompt: "x" }, { items: ITEMS, ask: () => ({ ok: true, text: "I think decision-tables" }), env: {} })],
    ["throws", scout({ prompt: "x" }, { items: ITEMS, ask: () => { throw new Error("boom"); }, env: {} })],
  ];
  for (const [name, r] of cases) {
    assert.equal(r.output, undefined, name);
    assert.ok(r.error, name);
  }
  const none = scout({ prompt: "x" }, { items: ITEMS, ask: () => ({ ok: true, text: '{"apply":[]}' }), env: {} });
  assert.equal(none.output, undefined);
  assert.equal(none.error, undefined);
});

test("scout reads the transcript's tail and doesn't repeat the new prompt", () => {
  const box = sandbox();
  const transcript = join(box.dir, "t.jsonl");
  writeFileSync(transcript, [line({ type: "user", message: { content: "we were talking about databases" } }), line({ type: "user", message: { content: "postgres or sqlite?" } })].join("\n"));
  let seen = "";
  scout({ prompt: "postgres or sqlite?", transcriptPath: transcript }, { items: ITEMS, ask: (p) => ((seen = p), { ok: true, text: '{"apply":[]}' }), env: {} });
  assert.match(seen, /\[user\] we were talking about databases/);
  assert.equal(seen.split("postgres or sqlite?").length, 2, "the prompt appears once, as the new request");
  scout({ prompt: "x", transcriptPath: join(box.dir, "missing.jsonl") }, { items: ITEMS, ask: (p) => ((seen = p), { ok: true, text: '{"apply":[]}' }), env: {} });
  assert.match(seen, /<recent-conversation>\n\(none\)/);
});

test("logRun appends one JSON line per run and keeps logs/ out of the basket's git", () => {
  const box = sandbox();
  logRun(box.basket, { prompt: "x", sessionId: "s1" }, { applied: [{ id: "a", why: "" }], ms: 12, candidates: 3 }, new Date("2026-10-29T00:00:00Z"));
  logRun(box.basket, undefined, { applied: [], error: "timed out", ms: 25000, candidates: 3 }, new Date("2026-10-29T00:00:01Z"));
  const lines = readFileSync(join(box.basket, "logs", "scout.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { at: "2026-10-29T00:00:00.000Z", session: "s1", ms: 12, candidates: 3, apply: ["a"] },
    { at: "2026-10-29T00:00:01.000Z", session: null, ms: 25000, candidates: 3, apply: [], error: "timed out" },
  ]);
  assert.equal(readFileSync(join(box.basket, "logs", ".gitignore"), "utf8"), "*\n");
});

// ── the CLI, with a fake `claude` on PATH ───────────────────────────────────────────

/** A basket with one egg, and a fake claude that records its args and stdin and replies $FAKE_REPLY. */
function wired(reply: string): Sandbox {
  const box = sandbox();
  assert.equal(cli(box, "lay", "Present options as a table", "--id", "decision-tables").status, 0);
  const bin = fakePath(box, {
    claude: `printf '%s\\n' "$@" > "${box.dir}/args"; cat > "${box.dir}/stdin"; env > "${box.dir}/env"; printf '%s' '${reply}'`,
  });
  box.env["PATH"] = `${bin}:${process.env["PATH"]}`;
  return box;
}

const hookRun = (box: Sandbox, stdin: string): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "..", "src", "cli.ts"), "scout", "--hook"], {
    env: box.env,
    cwd: box.dir,
    input: stdin,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

test("deveggs scout --hook prints the hook JSON and logs the run", () => {
  const box = wired('{"apply":[{"id":"decision-tables","why":"choosing a db"},{"id":"nope","why":"x"}]}');
  const r = hookRun(box, line({ prompt: "postgres or sqlite?", session_id: "abc" }));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(out.hookSpecificOutput.additionalContext, /`decision-tables` \(egg\): Present options as a table \(why: choosing a db\)/);
  const args = readFileSync(join(box.dir, "args"), "utf8").split("\n");
  for (const flag of ["-p", "--model", "haiku", "--tools", "--strict-mcp-config", "--no-session-persistence", "--system-prompt"]) assert.ok(args.includes(flag), flag);
  assert.match(readFileSync(join(box.dir, "stdin"), "utf8"), /postgres or sqlite\?/);
  assert.match(readFileSync(join(box.dir, "env"), "utf8"), /^DEVEGGS_SCOUT=1$/m, "the child carries the recursion guard");
  const log = JSON.parse(readFileSync(join(box.basket, "logs", "scout.log"), "utf8").trim());
  assert.equal(log.session, "abc");
  assert.deepEqual(log.apply, ["decision-tables"]);
});

test("deveggs scout --hook does nothing inside a scout (recursion guard)", () => {
  const box = wired('{"apply":[{"id":"decision-tables","why":"x"}]}');
  box.env["DEVEGGS_SCOUT"] = "1";
  const r = hookRun(box, line({ prompt: "anything" }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(existsSync(join(box.dir, "args")), false, "claude never ran");
  assert.equal(existsSync(join(box.basket, "logs", "scout.log")), false);
});

test("deveggs scout --hook fails open on bad input, a missing claude, a failing claude, a timeout or no basket", () => {
  const box = wired("not json at all");
  for (const stdin of ["", "garbage", line({ prompt: "x" })]) {
    const r = hookRun(box, stdin);
    assert.equal(r.status, 0, stdin);
    assert.equal(r.stdout, "", stdin);
  }
  const failing = wired("");
  writeFileSync(join(failing.dir, "bin", "claude"), "#!/bin/sh\necho 'auth error' >&2\nexit 1\n");
  assert.deepEqual([hookRun(failing, line({ prompt: "x" })).status, hookRun(failing, line({ prompt: "x" })).stdout], [0, ""]);
  assert.match(readFileSync(join(failing.basket, "logs", "scout.log"), "utf8"), /"error":"claude exited 1: auth error"/);

  const slow = wired("");
  writeFileSync(join(slow.dir, "bin", "claude"), "#!/bin/sh\nsleep 5\n");
  slow.env["DEVEGGS_SCOUT_TIMEOUT_MS"] = "300";
  const timed = hookRun(slow, line({ prompt: "x" }));
  assert.deepEqual([timed.status, timed.stdout], [0, ""]);
  assert.match(readFileSync(join(slow.basket, "logs", "scout.log"), "utf8"), /timed out after 300 ms/);

  const missing = wired("");
  missing.env["PATH"] = fakePath(sandbox(), {}); // git only, no claude
  const m = hookRun(missing, line({ prompt: "x" }));
  assert.deepEqual([m.status, m.stdout], [0, ""]);
  assert.match(readFileSync(join(missing.basket, "logs", "scout.log"), "utf8"), /claude not found/);

  const empty = sandbox();
  const e = hookRun(empty, line({ prompt: "x" }));
  assert.deepEqual([e.status, e.stdout], [0, ""]);
  assert.equal(existsSync(empty.basket), false, "no basket is created");
});

test("deveggs scout --dry-run shows the picks and latency for a prompt", () => {
  const box = wired('{"apply":[{"id":"decision-tables","why":"choosing a db"}]}');
  const r = cli(box, "scout", "--dry-run", "postgres or sqlite?");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /🔭 scout: \d+ ms, 1 candidates, model haiku/);
  assert.match(r.stdout, /✅ decision-tables: choosing a db/);
  assert.match(r.stdout, /hook output:\n\{"hookSpecificOutput"/);
  assert.equal(existsSync(join(box.basket, "logs", "scout.log")), false, "dry runs don't count toward the log");
  assert.equal(cli(box, "scout", "--dry-run").status, 1, "a prompt is required");
});
