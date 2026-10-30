import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { cli, fakePath, repoRoot, type Sandbox, sandbox } from "./sandbox.ts";

// The Claude Code mod (plugins/claude-code/hooks/register.js), driven by fake events and a
// fake mods API. Its `$.process.run` runs the real deveggs CLI against a sandbox basket, so
// these cover the mod and `deveggs scout --subagent` together, without Claude Code.

const MODULE = join(repoRoot, "plugins", "claude-code", "hooks", "register.js");
const SCOUT = "deveggs:deveggs-scout";

type Hook = (api: Api, e: Record<string, unknown>, next: Next) => Promise<unknown>;
type Next = ((e: Record<string, unknown>) => Promise<unknown>) & { origin?: { plugin: string }; budget?: { remainingMs: number } };

interface Api {
  plugin: { name: string; root: string };
  env: { get: (name: string) => Promise<string | undefined> };
  process: { run: (argv: string[], init?: { stdin?: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }> };
  agent: { register: (spec: Record<string, unknown>) => Promise<{ agent: string }>; spawn: (args: Record<string, unknown>) => Promise<Record<string, unknown>> };
  session: { id: () => Promise<string>; messages: () => Promise<unknown[]>; append: (args: unknown) => Promise<unknown> };
}

interface Rig {
  box: Sandbox;
  fire: (event: string, e: Record<string, unknown>, budget?: { remainingMs: number }) => Promise<unknown>;
  registered: Record<string, unknown>[];
  spawned: Record<string, unknown>[];
  appended: unknown[];
}

/** A fresh copy of the mod (its module state is per session) wired to a fake mods API. */
async function rig(opts: { wait?: string; reply?: (agentId: string, fire: Rig["fire"]) => void; basket?: boolean; deny?: string; noDeveggs?: boolean } = {}): Promise<Rig> {
  const box = sandbox();
  if (opts.basket !== false) assert.equal(cli(box, "lay", "Present options as a table", "--id", "decision-tables").status, 0);
  // The fallback hook's own checker, never the real claude.
  box.env["PATH"] = `${fakePath(box, { claude: `cat > /dev/null; printf '%s' '{"apply":[]}'` })}:${process.env["PATH"]}`;
  const hooks = new Map<string, Hook>();
  const on = (event: string, ...rest: unknown[]) => {
    hooks.set(event, rest[rest.length - 1] as Hook);
    return { catch: () => undefined };
  };
  const registered: Record<string, unknown>[] = [];
  const spawned: Record<string, unknown>[] = [];
  const appended: unknown[] = [];
  let n = 0;
  const fire = async (event: string, e: Record<string, unknown>, budget?: { remainingMs: number }): Promise<unknown> => {
    const hook = hooks.get(event);
    const next: Next = Object.assign(async (out: Record<string, unknown>) => ({ next: out }), { origin: { plugin: "engine" }, ...(budget && { budget }) });
    return hook ? hook(api, e, next) : next(e);
  };
  const api: Api = {
    plugin: { name: "deveggs", root: opts.noDeveggs ? join(box.dir, "nowhere", "plugin") : join(repoRoot, "plugins", "claude-code") },
    env: { get: async (name) => (name === "DEVEGGS_SCOUT_WAIT_MS" ? opts.wait : undefined) },
    process: {
      run: async (argv, init) => {
        const r = spawnSync(argv[0] as string, argv.slice(1), { env: box.env, cwd: box.dir, input: init?.stdin ?? "", encoding: "utf8" });
        if (r.error) throw r.error;
        return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
      },
    },
    agent: {
      register: async (spec) => (registered.push(spec), { agent: `deveggs:${String(spec["name"])}` }),
      spawn: async (args) => {
        spawned.push(args);
        if (opts.deny) return { deny: opts.deny };
        const agentId = `a${++n}`;
        opts.reply?.(agentId, fire);
        return { model: "haiku", agentId };
      },
    },
    session: { id: async () => "s1", messages: async () => [{ role: "user", text: "earlier", toolUses: [] }], append: async (args) => (appended.push(args), {}) },
  };
  const mod = (await import(`${pathToFileURL(MODULE).href}?${Math.random()}`)) as { register: (on: unknown) => void };
  mod.register(on);
  return { box, fire, registered, spawned, appended };
}

const prompt = (text: string, kind = "composer"): Record<string, unknown> => ({ text, origin: { kind }, wait: false });
const VERDICT = '{"apply":[{"id":"decision-tables","why":"a db choice"}]}';
const handback = (fire: Rig["fire"], agentId: string, message: string) => fire("tool.call", { tool: "SubagentHandback", tool_use_id: "t", agentId, message });
const log = (box: Sandbox) => readFileSync(join(box.basket, "logs", "scout.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("the mod registers a hidden, tool-less scout subagent from deveggs's spec, and lets only its own spawn through", async () => {
  const r = await rig();
  await r.fire("session.start", {});
  assert.equal(r.registered.length, 1);
  assert.deepEqual({ ...r.registered[0], description: undefined, prompt: undefined }, { name: "deveggs-scout", description: undefined, prompt: undefined, model: "haiku", tools: [], omitClaudeMd: true, maxTurns: 1 });
  assert.match(String(r.registered[0]?.["prompt"]), /^You route a developer's standing preferences/);
  assert.deepEqual(await r.fire("agent.offer", { agent: SCOUT }), { isOffered: false }, "the model never sees it");
  assert.deepEqual(await r.fire("agent.offer", { agent: "Explore" }), { next: { agent: "Explore" } });
  assert.equal((await r.fire("tool.check", { tool: "Agent", input: { subagent_type: SCOUT } }) as { decision: string }).decision, "allow");
  assert.deepEqual(await r.fire("tool.check", { tool: "Agent", input: { subagent_type: "Explore" } }), { next: { tool: "Agent", input: { subagent_type: "Explore" } } });
  assert.equal((await r.fire("tool.check", { tool: "Bash", input: { subagent_type: SCOUT } }) as { next?: unknown }).next !== undefined, true, "only a spawn is allowed");
  assert.equal((await r.fire("tool.check", { tool: "Agent", agentId: "x", input: { subagent_type: SCOUT } }) as { next?: unknown }).next !== undefined, true, "not from inside a subagent");
  assert.deepEqual(await r.fire("classic.UserPromptSubmit", { prompt: "x" }), { next: { prompt: "x" } }, "a prompt it didn't scout keeps the fallback hook");
});

test("each prompt spawns the scout with deveggs's question; an answer in time is added to the prompt and its report never reaches the main model", async () => {
  let delivered: unknown;
  const r = await rig({
    reply: (id, fire) =>
      setTimeout(async () => {
        delivered = await handback(fire, id, VERDICT);
      }, 20),
  });
  await r.fire("session.start", {});
  const out = (await r.fire("prompt.submit", prompt("postgres or sqlite?"))) as { next: { context?: string[] } };
  assert.deepEqual(await r.fire("classic.UserPromptSubmit", { prompt: "postgres or sqlite?" }), { next: { prompt: "postgres or sqlite?", deveggs_scout: "subagent" } }, "the fallback hook is told to stay silent");
  assert.deepEqual(await r.fire("classic.UserPromptSubmit", { prompt: "postgres or sqlite?" }), { next: { prompt: "postgres or sqlite?" } }, "once");
  assert.equal(r.spawned.length, 1);
  assert.equal(r.spawned[0]?.["subagentType"], SCOUT);
  assert.match(String(r.spawned[0]?.["prompt"]), /\[user\] earlier[\s\S]*<new-request>\npostgres or sqlite\?\n<\/new-request>/);
  assert.equal(out.next.context?.length, 1);
  assert.match(out.next.context?.[0] ?? "", /^deveggs scout \(fresh-context check\)[\s\S]*`decision-tables` \(egg\): Present options as a table \(why: a db choice\)/);
  assert.deepEqual(delivered, { result: { success: true, message: "Report delivered to your caller." } }, "deveggs answers the handback itself");
  assert.deepEqual(await r.fire("session.receive", { agentId: "a1", text: VERDICT, origin: { kind: "peer" } }), { consumed: "deveggs scout" });
  assert.deepEqual(await r.fire("prompt.submit", prompt('Agent "a1" completed', "task-notification")), { drop: "deveggs scout" });
  assert.deepEqual(await r.fire("prompt.submit", prompt('Agent "a1" completed', "task-notification")), { next: prompt('Agent "a1" completed', "task-notification") }, "only its first notice");
  const [run] = log(r.box);
  assert.deepEqual([run.harness, run.checker, run.session, run.apply], ["claude-code", "subagent", "s1", ["decision-tables"]]);
  assert.equal(r.appended.length, 0);
});

test("a scout slower than the wait lets the prompt go ahead, then appends its context once it lands", async () => {
  let land: (() => Promise<unknown>) | undefined;
  const r = await rig({ wait: "10", reply: (id, fire) => (land = () => fire("turn.complete", { agentId: id, answer: VERDICT, isAborted: false })) });
  await r.fire("session.start", {});
  const out = (await r.fire("prompt.submit", prompt("postgres or sqlite?"))) as { next: Record<string, unknown> };
  assert.equal(out.next["context"], undefined, "nothing waited past the limit");
  await land?.();
  assert.equal(r.appended.length, 1);
  assert.match(JSON.stringify(r.appended[0]), /answered after this turn began[\s\S]*decision-tables/);
  await r.fire("turn.complete", { agentId: "a1", answer: VERDICT, isAborted: false });
  assert.equal(r.appended.length, 1, "appended once");
});

test("a handback and the scout's turn ending back to back inject once; a huge wait is capped inside the hook's budget", async () => {
  const r = await rig({
    reply: (id, fire) =>
      setTimeout(() => {
        void handback(fire, id, VERDICT);
        void fire("turn.complete", { agentId: id, answer: VERDICT, isAborted: false });
      }, 5),
  });
  await r.fire("session.start", {});
  const out = (await r.fire("prompt.submit", prompt("postgres or sqlite?"))) as { next: { context?: string[] } };
  assert.equal(out.next.context?.length, 1);
  await new Promise((done) => setTimeout(done, 300));
  assert.equal(r.appended.length, 0, "never appended as well");
  assert.equal(log(r.box).length, 1, "one run logged");

  const slow = await rig({ wait: "60000" });
  await slow.fire("session.start", {});
  const started = Date.now();
  await slow.fire("prompt.submit", prompt("postgres or sqlite?"), { remainingMs: 1700 });
  assert.ok(Date.now() - started < 3000, "waited within the budget, not 60 s");
});

test("a scouted prompt leaves a per-session stamp, so the fallback hook stays silent even without the mark; a refused spawn takes it back", async () => {
  const r = await rig({ reply: (id, fire) => setTimeout(() => handback(fire, id, '{"apply":[]}'), 5) });
  await r.fire("session.start", {});
  await r.fire("prompt.submit", prompt("postgres or sqlite?"));
  const hook = (p: string) =>
    spawnSync(join(repoRoot, "bin", "deveggs"), ["scout", "--hook", "--harness", "claude-code"], { env: r.box.env, input: JSON.stringify({ prompt: p, session_id: "s1" }), encoding: "utf8" });
  assert.equal(hook("postgres or sqlite?").stdout, "");
  assert.equal(log(r.box).length, 1, "the hook didn't run a check of its own");
  hook("another prompt");
  assert.equal(log(r.box).length, 2, "a prompt the mod didn't take is the fallback's");

  const refused = await rig({ deny: "no" });
  await refused.fire("session.start", {});
  await refused.fire("prompt.submit", prompt("postgres or sqlite?"));
  assert.equal(existsSync(join(refused.box.basket, "logs", "scout-cache", "subagent-s1.json")), false);
});

test("the mod stays out of the way: other prompts, nothing that applies, a refused spawn, or no basket", async () => {
  const r = await rig({ reply: (id, fire) => setTimeout(() => handback(fire, id, '{"apply":[]}'), 5) });
  await r.fire("session.start", {});
  assert.deepEqual(await r.fire("prompt.submit", prompt("note", "task-notification")), { next: prompt("note", "task-notification") });
  assert.deepEqual(await r.fire("prompt.submit", { ...prompt("/help"), command: { name: "help" } }), { next: { ...prompt("/help"), command: { name: "help" } } });
  assert.equal(r.spawned.length, 0, "only the developer's own prompts are scouted");
  assert.deepEqual(await r.fire("prompt.submit", prompt("what's 2+2")), { next: prompt("what's 2+2") }, "nothing applies: the prompt is unchanged");

  const empty = await rig({ basket: false });
  await empty.fire("session.start", {});
  assert.deepEqual(await empty.fire("prompt.submit", prompt("x")), { next: prompt("x") }, "no basket: no question, no spawn");
  assert.equal(empty.spawned.length, 0);
  assert.equal(existsSync(join(empty.box.basket, "logs", "scout.log")), false);

  const refused = await rig({ deny: "a plugin refused it" });
  await refused.fire("session.start", {});
  assert.deepEqual(await refused.fire("prompt.submit", prompt("postgres or sqlite?")), { next: prompt("postgres or sqlite?") });
  assert.equal(log(refused.box)[0].error, "spawn refused: a plugin refused it");

  const broken = await rig({ noDeveggs: true });
  await broken.fire("session.start", {});
  assert.equal(broken.registered.length, 0, "no deveggs CLI: no scout");
  assert.deepEqual(await broken.fire("classic.UserPromptSubmit", { prompt: "x" }), { next: { prompt: "x" } }, "and the fallback hook keeps the prompt");
  assert.deepEqual(await broken.fire("prompt.submit", prompt("x")), { next: prompt("x") });
});
