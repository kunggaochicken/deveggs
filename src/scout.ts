import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firesWhen } from "./architecture.ts";
import type { Egg } from "./basket.ts";

// `deveggs scout` is the attention half of deveggs acting as a harness layer: install
// guarantees PREFERENCES.md is loaded, scout guarantees the rules that fit this prompt are
// noticed. The harness's own prompt-submit hook runs it on every prompt and names itself
// with `--harness`; scout asks a headless checker, in a fresh context, which eggs and
// chickens fire for what the main agent is about to do, and injects those through the
// hook's output. The hook is always the harness's own; only the checker can be borrowed.
// A harness with its own isolated headless mode checks with it (a Codex session is scouted
// by `codex exec`, a Claude Code one by `claude -p`, never each other). One without it
// (Antigravity: `agy -p` saves every run as a conversation and runs hooks) borrows the
// developer's default scout agent, picked at `deveggs install`. It fails open: any problem
// means no output and exit 0, so it never blocks a prompt.
//
// Everything here is harness-agnostic (candidates, the prompt, the verdict, sanitising,
// logging, failing open, the recursion guard) except an Adapter (how a harness's hook
// input and transcript read, and what its hook prints) and a Checker (how a headless CLI
// is asked).

/** Set on the scout's own headless run, so a hook inside it can't scout again. */
export const GUARD = "DEVEGGS_SCOUT";
/** Typical runs take 2–5 s; during an outage each prompt waits this long, so keep it short. */
export const DEFAULT_TIMEOUT_MS = 12_000;
/** What every installed hook entry contains; install and uninstall find their own entry by it. */
export const HOOK_ARGS = "scout --hook";

/** Harnesses whose prompt hook can inject the scout's context. */
export const SCOUT_HARNESSES = ["claude-code", "codex", "antigravity"] as const;
export type ScoutHarness = (typeof SCOUT_HARNESSES)[number];
export const isScoutHarness = (value: unknown): value is ScoutHarness => (SCOUT_HARNESSES as readonly unknown[]).includes(value);

/** Agents whose headless CLI can run the check isolated, and so can be the default scout agent. */
export const SCOUT_AGENTS = ["claude-code", "codex"] as const;
export type ScoutAgent = (typeof SCOUT_AGENTS)[number];
export const isScoutAgent = (value: unknown): value is ScoutAgent => (SCOUT_AGENTS as readonly unknown[]).includes(value);
/** A saved or passed default: an agent, or "none" (no scout where a harness has no checker of its own). */
export type ScoutDefault = ScoutAgent | "none";
export const isScoutDefault = (value: unknown): value is ScoutDefault => value === "none" || isScoutAgent(value);
/** Overrides the default scout agent saved by `deveggs install`. */
export const DEFAULT_ENV = "DEVEGGS_SCOUT_DEFAULT";

/** The parts of a prompt hook's input that scout uses. */
export interface HookInput {
  prompt: string;
  transcriptPath?: string;
  cwd?: string;
  sessionId?: string;
  /** Antigravity's PreInvocation: which model call of the turn this is (0 on a new prompt). */
  invocation?: number;
}

function parseObject(text: string): Record<string, unknown> | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

const strOf = (o: Record<string, unknown>, k: string): string | undefined => (typeof o[k] === "string" && o[k] ? (o[k] as string) : undefined);

/** A UserPromptSubmit hook's input (Claude Code and Codex send the same fields). */
export function parseHookInput(text: string): HookInput | undefined {
  const o = parseObject(text);
  if (!o) return undefined;
  if (typeof o["prompt"] !== "string" || !o["prompt"].trim()) return undefined;
  const transcriptPath = strOf(o, "transcript_path");
  const cwd = strOf(o, "cwd");
  const sessionId = strOf(o, "session_id");
  return {
    prompt: o["prompt"],
    ...(transcriptPath && { transcriptPath }),
    ...(cwd && { cwd }),
    ...(sessionId && { sessionId }),
  };
}

/** Antigravity wraps the developer's words in `<USER_REQUEST>`, with metadata blocks after it. */
export function userRequest(text: string): string {
  const inner = /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(text)?.[1];
  return (inner ?? text).trim();
}

/**
 * Antigravity's PreInvocation input: `lastUserInput` (agy 1.4.10 sends it, though its docs
 * list only the common fields), `invocationNum`, `conversationId`, `transcriptPath`.
 * Without `lastUserInput` the prompt is empty and scout takes the transcript's last request.
 */
export function parseAntigravityInput(text: string): HookInput | undefined {
  const o = parseObject(text);
  if (!o) return undefined;
  const invocation = o["invocationNum"];
  if (typeof invocation !== "number" || !Number.isInteger(invocation) || invocation < 0) return undefined;
  const transcriptPath = strOf(o, "transcriptPath");
  const sessionId = strOf(o, "conversationId");
  const workspaces = o["workspacePaths"];
  const cwd = Array.isArray(workspaces) && typeof workspaces[0] === "string" ? workspaces[0] : undefined;
  const prompt = typeof o["lastUserInput"] === "string" ? userRequest(o["lastUserInput"]) : "";
  if (!prompt && !transcriptPath) return undefined;
  return {
    prompt,
    invocation,
    ...(transcriptPath && { transcriptPath }),
    ...(cwd && { cwd }),
    ...(sessionId && { sessionId }),
  };
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface TailOptions {
  turns?: number;
  perTurn?: number;
  total?: number;
}

/** Harness-injected blocks that say nothing about what the developer asked. */
const NOISE = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>[\s\S]*?<\/\1>/g;

/** Keep the last `turns`, each cut to `perTurn` characters, dropping the oldest until they fit `total`. */
function trimTurns(all: Turn[], opts: TailOptions): Turn[] {
  const { turns = 6, perTurn = 600, total = 3000 } = opts;
  const tail = all.slice(-turns).map((t) => (t.text.length > perTurn ? { ...t, text: `${t.text.slice(0, perTurn)}…` } : t));
  while (tail.length > 1 && tail.reduce((n, t) => n + t.text.length, 0) > total) tail.shift();
  return tail;
}

/** Each JSONL line as an object, skipping a partial first line from reading the file's tail. */
function* jsonLines(jsonl: string): Generator<Record<string, unknown>> {
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (entry && typeof entry === "object") yield entry as Record<string, unknown>;
    } catch {
      // a partial line
    }
  }
}

function turnText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  // A user line carrying tool results is the harness talking, not the developer.
  if (content.some((b) => b && typeof b === "object" && (b as { type?: unknown }).type === "tool_result")) return undefined;
  const texts = content
    .filter((b): b is { type: "text"; text: string } => !!b && typeof b === "object" && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string")
    .map((b) => b.text);
  return texts.length ? texts.join("\n") : undefined;
}

/**
 * The last few user and assistant text turns of a Claude Code transcript (JSONL), oldest
 * first. Skips tool calls and results, meta lines and harness-injected blocks; each turn
 * is cut to `perTurn` characters and the whole tail to `total`.
 */
export function transcriptTail(jsonl: string, opts: TailOptions = {}): Turn[] {
  const out: Turn[] = [];
  for (const entry of jsonLines(jsonl)) {
    const type = entry["type"];
    if ((type !== "user" && type !== "assistant") || entry["isMeta"] === true || entry["isSidechain"] === true) continue;
    const text = turnText((entry["message"] as { content?: unknown } | undefined)?.content)?.replace(NOISE, "").trim();
    if (text) out.push({ role: type, text });
  }
  return trimTurns(out, opts);
}

/**
 * The same tail from a Codex rollout (JSONL). Codex documents the hook's `transcript_path`
 * but not the rollout's format, so this reads only the messages the developer saw (an
 * `item_completed` event holding a `UserMessage` or `AgentMessage`, as codex-cli 0.161
 * writes them) and finds nothing in any other shape: a format change costs the scout its
 * context, never a prompt.
 */
export function codexTranscriptTail(jsonl: string, opts: TailOptions = {}): Turn[] {
  const out: Turn[] = [];
  for (const entry of jsonLines(jsonl)) {
    const payload = entry["payload"] as { type?: unknown; item?: { type?: unknown; content?: unknown } } | undefined;
    if (entry["type"] !== "event_msg" || payload?.type !== "item_completed") continue;
    const kind = payload.item?.type;
    const role = kind === "UserMessage" ? "user" : kind === "AgentMessage" ? "assistant" : undefined;
    const content = payload.item?.content;
    if (!role || !Array.isArray(content)) continue;
    const text = content
      .filter((b): b is { text: string } => !!b && typeof b === "object" && String((b as { type?: unknown }).type).toLowerCase() === "text" && typeof (b as { text?: unknown }).text === "string")
      .map((b) => b.text)
      .join("\n")
      .replace(NOISE, "")
      .trim();
    if (text) out.push({ role, text });
  }
  return trimTurns(out, opts);
}

/**
 * The same tail from an Antigravity transcript (`<brain>/<conversation>/.system_generated/
 * logs/transcript.jsonl`). Its docs give the path but not the format, so this reads only
 * what agy 1.4.10 writes for the developer's requests (`USER_INPUT`, the words inside
 * `<USER_REQUEST>`) and the model's replies (`PLANNER_RESPONSE` with text `content`), and
 * finds nothing in any other shape.
 */
export function antigravityTranscriptTail(jsonl: string, opts: TailOptions = {}): Turn[] {
  const out: Turn[] = [];
  for (const entry of jsonLines(jsonl)) {
    const content = entry["content"];
    if (typeof content !== "string") continue;
    const role = entry["type"] === "USER_INPUT" ? "user" : entry["type"] === "PLANNER_RESPONSE" ? "assistant" : undefined;
    if (!role) continue;
    const text = (role === "user" ? userRequest(content) : content).replace(NOISE, "").trim();
    if (text) out.push({ role, text });
  }
  return trimTurns(out, opts);
}

/** Read at most the last `bytes` of a file: transcripts grow to many megabytes. */
export function readTail(path: string, bytes = 256 * 1024): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, size - length);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export interface Candidate {
  id: string;
  tier: "egg" | "chicken";
  when?: string;
  fact: string;
}

/** Every egg and chicken scout can pick; cracked items never apply. */
export function candidates(items: Egg[]): Candidate[] {
  return items
    .filter((e): e is Egg & { tier: "egg" | "chicken" } => e.tier === "egg" || e.tier === "chicken")
    .map((e) => {
      const when = firesWhen(e.body);
      return { id: e.id, tier: e.tier, fact: e.summary, ...(when && { when }) };
    });
}

export const SYSTEM_PROMPT =
  "You route a developer's standing preferences to the moment they apply. You never do the task yourself. " +
  'Reply with one JSON object and nothing else: {"apply":[{"id":"<id>","why":"<one short clause>"}]}.';

/** The scout's question: the candidates, the recent conversation, and the new request. */
export function scoutPrompt(prompt: string, turns: Turn[], items: Candidate[]): string {
  const list = items.map((c) => `- ${c.id} (${c.tier}) | fires when: ${c.when ?? "(not stated; judge by the fact)"} | fact: ${c.fact}`).join("\n");
  const recent = turns.length ? turns.map((t) => `[${t.role}] ${t.text}`).join("\n\n") : "(none)";
  return [
    "A coding agent is about to respond to the developer's NEW REQUEST below. Decide which of the developer's preferences apply to what the agent will do next.",
    "",
    "Rules:",
    "- Pick an item only if its \"fires when\" clearly matches what the agent is about to do for this request (or the fact plainly governs it).",
    "- Be precise: when in doubt, leave it out. Most requests match zero to three items.",
    "- Use only ids from the list. `why` is one short clause naming what in the request triggers it.",
    '- Reply with exactly one JSON object: {"apply":[{"id":"...","why":"..."}]}, or {"apply":[]} when none apply.',
    "",
    "<preferences>",
    list,
    "</preferences>",
    "",
    "<recent-conversation>",
    recent,
    "</recent-conversation>",
    "",
    "<new-request>",
    prompt.length > 4000 ? `${prompt.slice(0, 4000)}…` : prompt,
    "</new-request>",
  ].join("\n");
}

export interface Applied {
  id: string;
  why: string;
}

/**
 * `why` is model text, and the model read transcript turns that may quote untrusted
 * content, so it reaches the main session only as one short plain clause.
 */
export function cleanWhy(why: string): string {
  const flat = why.replace(/[`<>]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}

/**
 * The scout's verdict, kept to ids the basket knows (each once). Undefined when the reply
 * holds no `{"apply": [...]}` object.
 */
export function parseVerdict(text: string, known: Set<string>): Applied[] | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const apply = (raw as { apply?: unknown } | null)?.apply;
  if (!Array.isArray(apply)) return undefined;
  const seen = new Set<string>();
  const out: Applied[] = [];
  for (const a of apply) {
    const id = (a as { id?: unknown } | null)?.id;
    const why = (a as { why?: unknown } | null)?.why;
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, why: typeof why === "string" ? cleanWhy(why) : "" });
  }
  return out;
}

/** The context the main session gets, naming each item, its fact and why it applies. */
export function contextFor(applied: Applied[], items: Candidate[]): string {
  const byId = new Map(items.map((c) => [c.id, c]));
  const lines = applied.map((a) => {
    const c = byId.get(a.id);
    return `- \`${a.id}\` (${c?.tier ?? "egg"}): ${c?.fact ?? ""}${a.why ? ` (why: ${a.why})` : ""}`;
  });
  const eggs = applied.some((a) => byId.get(a.id)?.tier === "egg");
  return [
    "deveggs scout (fresh-context check): these preferences apply to this request. Follow them and cite the ids you applied:",
    ...lines,
    ...(eggs ? ["Eggs are on trial: once you see how one went, record it with `deveggs feedback <id> --good|--bad --note \"…\"`."] : []),
  ].join("\n");
}

/** The UserPromptSubmit hook's stdout. Claude Code and Codex both read this shape. */
export const hookOutput = (context: string): string =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } });

/** Antigravity's PreInvocation stdout: one ephemeral step, a transient system message for this model call. */
export const antigravityOutput = (context: string): string => JSON.stringify({ injectSteps: [{ ephemeralMessage: context }] });

export type AskResult = { ok: true; text: string } | { ok: false; error: string };
/** Ask a fresh-context model. Injectable, so tests never call a real CLI. */
export type Ask = (prompt: string, opts: { model: string; timeoutMs: number }) => AskResult;

/**
 * Run a harness's headless CLI once: from a temp folder, killed at the timeout, with
 * DEVEGGS_SCOUT=1 so a hook that still fires inside it can't scout again.
 */
function runHeadless(cmd: string, args: string[], input: string, timeoutMs: number): AskResult {
  const r = spawnSync(cmd, args, {
    input,
    cwd: tmpdir(),
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    env: { ...process.env, [GUARD]: "1" },
    maxBuffer: 1024 * 1024,
  });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return { ok: false, error: `${cmd} not found` };
  if (code === "ETIMEDOUT" || r.signal) return { ok: false, error: `timed out after ${timeoutMs} ms` };
  // A CLI that exits before reading its stdin (bad login, bad flag) breaks the pipe; its exit
  // status and stderr say why, so fall through to them.
  if (r.error && code !== "EPIPE") return { ok: false, error: r.error.message };
  if (r.status === null) return { ok: false, error: r.error?.message ?? `${cmd} exited without a status` };
  if (r.status !== 0) return { ok: false, error: `${cmd} exited ${r.status}: ${(r.stderr || r.stdout).trim().split("\n")[0] ?? ""}` };
  return { ok: true, text: r.stdout };
}

/**
 * Claude Code's checker: a headless `claude -p` kept cheap and isolated. No tools, no MCP
 * servers, no settings files (so none of the developer's hooks), no slash commands, nothing
 * saved to disk, its own system prompt (so no CLAUDE.md).
 */
export const askClaude: Ask = (prompt, { model, timeoutMs }) =>
  runHeadless(
    "claude",
    ["-p", "--model", model, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence", "--system-prompt", SYSTEM_PROMPT],
    prompt,
    timeoutMs,
  );

/** The flags that keep `codex exec` a cheap, isolated one-shot (see askCodex). */
export const CODEX_ARGS = [
  "exec",
  "--ephemeral",
  "--skip-git-repo-check",
  "--ignore-user-config",
  "--ignore-rules",
  "--disable", "hooks",
  "--sandbox", "read-only",
  "-c", "model_reasoning_effort=low",
  "-c", "project_doc_max_bytes=0",
  "--color", "never",
] as const;

/**
 * Codex's checker: a headless `codex exec`, as cheap and isolated as Codex allows. Nothing
 * saved to disk (--ephemeral), no config.toml (so no MCP servers, profiles or hook trust),
 * hooks off, no execpolicy rules, a read-only sandbox (exec never asks for approval), low
 * reasoning, no project docs. Codex has no flag to drop its tools or replace its system
 * prompt, and ~/.codex/AGENTS.md still loads, so the routing instruction leads the prompt
 * and tells it to leave tools and those instructions alone. Its stdout is the final message
 * only, and it signs in with the developer's own Codex login.
 */
export const CODEX_PREAMBLE =
  "Answer from this message alone: run no commands, call no tools, and ignore any AGENTS.md or other standing instructions you were given; they are not the task.";

export const askCodex: Ask = (prompt, { model, timeoutMs }) =>
  runHeadless("codex", [...CODEX_ARGS, "--model", model, "-"], `${CODEX_PREAMBLE}\n${SYSTEM_PROMPT}\n\n${prompt}`, timeoutMs);

/** A headless CLI that can run the check in a fresh, isolated context. */
export interface Checker {
  agent: ScoutAgent;
  /** The command, for messages. */
  name: string;
  defaultModel: string;
  /** This checker's model override; DEVEGGS_SCOUT_MODEL is the fallback for every checker. */
  modelEnv: string;
  ask: Ask;
}

export const CHECKERS: Record<ScoutAgent, Checker> = {
  "claude-code": { agent: "claude-code", name: "claude -p", defaultModel: "haiku", modelEnv: "DEVEGGS_SCOUT_CLAUDE_MODEL", ask: askClaude },
  // Codex's small, fast model in codex-cli 0.161; DEVEGGS_SCOUT_CODEX_MODEL overrides it as models change.
  codex: { agent: "codex", name: "codex exec", defaultModel: "gpt-6-luna", modelEnv: "DEVEGGS_SCOUT_CODEX_MODEL", ask: askCodex },
};

/** What differs per harness: reading its hook input and transcript, its own checker if it has one, printing its hook output. */
export interface Adapter {
  harness: ScoutHarness;
  /** Its own isolated headless checker; without one, the scout borrows the default agent's. */
  native?: Checker;
  parse: (text: string) => HookInput | undefined;
  tail: (jsonl: string) => Turn[];
  output: (context: string) => string;
}

export const ADAPTERS: Record<ScoutHarness, Adapter> = {
  "claude-code": { harness: "claude-code", native: CHECKERS["claude-code"], parse: parseHookInput, tail: transcriptTail, output: hookOutput },
  codex: { harness: "codex", native: CHECKERS.codex, parse: parseHookInput, tail: codexTranscriptTail, output: hookOutput },
  // `agy -p` can't run isolated (every run is saved as a conversation and runs hooks), so it borrows the default agent's checker.
  antigravity: { harness: "antigravity", parse: parseAntigravityInput, tail: antigravityTranscriptTail, output: antigravityOutput },
};

/** A checker's model: its own override, then DEVEGGS_SCOUT_MODEL, then its default. */
export const modelFor = (checker: Checker, env: NodeJS.ProcessEnv): string => env[checker.modelEnv] || env["DEVEGGS_SCOUT_MODEL"] || checker.defaultModel;

/** Which checker a run uses and how it was chosen (`native` or `fallback:<agent>`), or why there is none. */
export type Resolved = { checker: Checker; via: string } | { error: string; via: string };

/**
 * The checker for a harness: its own when it has one (the default never overrides it),
 * else the default scout agent (DEVEGGS_SCOUT_DEFAULT, then the one `deveggs install` saved).
 */
export function resolveChecker(adapter: Adapter, env: NodeJS.ProcessEnv, saved: string | undefined): Resolved {
  if (adapter.native) return { checker: adapter.native, via: "native" };
  const choice = env[DEFAULT_ENV] || saved;
  if (choice === undefined) return { error: "no default scout agent: run deveggs install, or set DEVEGGS_SCOUT_DEFAULT", via: "fallback" };
  if (choice === "none") return { error: "the default scout agent is none", via: "fallback:none" };
  if (!isScoutAgent(choice)) return { error: `unknown default scout agent ${JSON.stringify(choice)}; expected ${SCOUT_AGENTS.join(", ")} or none`, via: "fallback" };
  return { checker: CHECKERS[choice], via: `fallback:${choice}` };
}

export interface ScoutResult {
  /** Hook stdout; undefined means print nothing. */
  output?: string;
  /** The injected context (what `output` wraps), to re-send it. */
  context?: string;
  applied: Applied[];
  error?: string;
  ms: number;
  candidates: number;
  /** The prompt checked (Antigravity's may come from its transcript). */
  prompt?: string;
}

export interface ScoutDeps {
  items: Egg[];
  env: NodeJS.ProcessEnv;
  /** The harness whose hook is running; Claude Code when absent. */
  adapter?: Adapter;
  /** The checker to ask; the adapter's own when absent. */
  checker?: Checker;
  /** Replaces the checker's ask (tests). */
  ask?: Ask;
  now?: () => number;
}

/** Positive integer from the environment, or the fallback. */
function envInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** One scout run. Never throws: every failure comes back as `error` with no output. */
export function scout(input: HookInput, deps: ScoutDeps): ScoutResult {
  const now = deps.now ?? Date.now;
  const started = now();
  const adapter = deps.adapter ?? ADAPTERS["claude-code"];
  const checker = deps.checker ?? adapter.native;
  const done = (rest: Omit<ScoutResult, "ms" | "candidates">, n: number): ScoutResult => ({ ...rest, ms: now() - started, candidates: n });
  let items: Candidate[] = [];
  try {
    items = candidates(deps.items);
    if (!items.length) return done({ applied: [], error: "no eggs or chickens" }, 0);
    if (!checker) return done({ applied: [], error: `no checker for ${adapter.harness}` }, items.length);
    let turns: Turn[] = [];
    if (input.transcriptPath && existsSync(input.transcriptPath)) {
      try {
        turns = adapter.tail(readTail(input.transcriptPath));
      } catch {
        turns = []; // no context beats no scout
      }
    }
    // The new prompt may already be the transcript's last line; don't show it twice. With no
    // prompt in the input (Antigravity without lastUserInput), that line is the prompt.
    const last = turns[turns.length - 1];
    let prompt = input.prompt.trim();
    const same = last?.role === "user" && (!prompt || last.text === prompt || (last.text.endsWith("…") && prompt.startsWith(last.text.slice(0, -1))));
    if (same) turns.pop();
    if (!prompt && same && last) prompt = last.text;
    if (!prompt) return done({ applied: [], error: "no prompt" }, items.length);
    const ask = deps.ask ?? checker.ask;
    const model = modelFor(checker, deps.env);
    const timeoutMs = envInt(deps.env["DEVEGGS_SCOUT_TIMEOUT_MS"], DEFAULT_TIMEOUT_MS);
    const answer = ask(scoutPrompt(prompt, turns, items), { model, timeoutMs });
    if (!answer.ok) return done({ applied: [], error: answer.error, prompt }, items.length);
    const applied = parseVerdict(answer.text, new Set(items.map((c) => c.id)));
    if (!applied) return done({ applied: [], error: `unparseable reply: ${answer.text.trim().slice(0, 120)}`, prompt }, items.length);
    if (!applied.length) return done({ applied, prompt }, items.length);
    const context = contextFor(applied, items);
    return done({ applied, context, output: adapter.output(context), prompt }, items.length);
  } catch (err) {
    return done({ applied: [], error: (err as Error).message }, items.length);
  }
}

/**
 * One JSON line per run in `<basket>/logs/scout.log`, to measure hit rate and latency per
 * harness. logs/ gets its own `.gitignore` so a basket that doesn't ignore it never commits
 * the log.
 */
export function logRun(basket: string, input: HookInput | undefined, result: ScoutResult, harness: ScoutHarness = "claude-code", at = new Date(), checker?: string): void {
  try {
    const dir = join(basket, "logs");
    mkdirSync(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
    const line = {
      at: at.toISOString(),
      harness,
      ...(checker !== undefined && { checker }),
      session: input?.sessionId ?? null,
      ms: result.ms,
      candidates: result.candidates,
      apply: result.applied.map((a) => a.id),
      ...(result.error !== undefined && { error: result.error }),
    };
    appendFileSync(join(dir, "scout.log"), `${JSON.stringify(line)}\n`);
  } catch {
    // Logging must never fail the hook.
  }
}

/**
 * Antigravity fires PreInvocation before every model call of a turn, and an ephemeral step
 * is gone after the call it was injected into, so the context is re-sent on each later call
 * of the same turn. Only invocation 0 (a new prompt) runs the checker; it caches what it
 * injected per conversation, and later calls re-send it while the prompt is unchanged.
 */
export interface Cached {
  prompt: string;
  context?: string;
}

const SAFE_ID = /^[\w-][\w.-]{0,127}$/;
const cacheFile = (dir: string, conversation: string): string | undefined => (SAFE_ID.test(conversation) ? join(dir, `${conversation}.json`) : undefined);

/** Where re-sent contexts live: per user, in the temp folder, never in the basket. */
export const cacheDir = (): string => join(tmpdir(), `deveggs-scout-${process.getuid?.() ?? "user"}`);

export function saveCached(dir: string, conversation: string | undefined, cached: Cached): void {
  const file = conversation ? cacheFile(dir, conversation) : undefined;
  if (!file) return;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cached), { mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    // no cache: later calls of this turn just go without the context
  }
}

export function loadCached(dir: string, conversation: string | undefined): Cached | undefined {
  const file = conversation ? cacheFile(dir, conversation) : undefined;
  if (!file || !existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Cached;
    return typeof raw.prompt === "string" && (raw.context === undefined || typeof raw.context === "string") ? raw : undefined;
  } catch {
    return undefined;
  }
}
