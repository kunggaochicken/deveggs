import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firesWhen } from "./architecture.ts";
import type { Egg } from "./basket.ts";

// `deveggs scout` is the attention half of deveggs acting as a harness layer: install
// guarantees PREFERENCES.md is loaded, scout guarantees the rules that fit this prompt are
// noticed. A Claude Code UserPromptSubmit hook runs it on every prompt; it asks a
// fresh-context `claude -p` (no tools, no MCP, no settings, no session) which eggs and
// chickens fire for what the main agent is about to do, and injects those as
// additionalContext. It fails open: any problem means no output and exit 0, so it never
// blocks a prompt.

/** Set on the scout's own `claude -p`, so a hook inside it can't scout again. */
export const GUARD = "DEVEGGS_SCOUT";
export const DEFAULT_MODEL = "haiku";
/** Typical runs take 2–5 s; during an outage each prompt waits this long, so keep it short. */
export const DEFAULT_TIMEOUT_MS = 12_000;
/** What the settings.json hook entry contains; install and uninstall find their own entry by it. */
export const HOOK_ARGS = "scout --hook";

/** The parts of Claude Code's UserPromptSubmit hook input that scout uses. */
export interface HookInput {
  prompt: string;
  transcriptPath?: string;
  cwd?: string;
  sessionId?: string;
}

export function parseHookInput(text: string): HookInput | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o["prompt"] !== "string" || !o["prompt"].trim()) return undefined;
  const str = (k: string): string | undefined => (typeof o[k] === "string" && o[k] ? (o[k] as string) : undefined);
  const transcriptPath = str("transcript_path");
  const cwd = str("cwd");
  const sessionId = str("session_id");
  return {
    prompt: o["prompt"],
    ...(transcriptPath && { transcriptPath }),
    ...(cwd && { cwd }),
    ...(sessionId && { sessionId }),
  };
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** Harness-injected blocks that say nothing about what the developer asked. */
const NOISE = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>[\s\S]*?<\/\1>/g;

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
export function transcriptTail(jsonl: string, opts: { turns?: number; perTurn?: number; total?: number } = {}): Turn[] {
  const { turns = 6, perTurn = 600, total = 3000 } = opts;
  const out: Turn[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // a partial first line from reading the file's tail
    }
    const type = entry["type"];
    if ((type !== "user" && type !== "assistant") || entry["isMeta"] === true || entry["isSidechain"] === true) continue;
    const text = turnText((entry["message"] as { content?: unknown } | undefined)?.content)?.replace(NOISE, "").trim();
    if (!text) continue;
    out.push({ role: type, text: text.length > perTurn ? `${text.slice(0, perTurn)}…` : text });
  }
  const tail = out.slice(-turns);
  while (tail.length > 1 && tail.reduce((n, t) => n + t.text.length, 0) > total) tail.shift();
  return tail;
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

/** The UserPromptSubmit hook's stdout. */
export const hookOutput = (context: string): string =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } });

export type AskResult = { ok: true; text: string } | { ok: false; error: string };
/** Ask a fresh-context model. Injectable, so tests never call the real `claude`. */
export type Ask = (prompt: string, opts: { model: string; timeoutMs: number }) => AskResult;

/**
 * The real scout: a headless `claude -p` kept cheap and isolated. No tools, no MCP servers,
 * no settings files (so none of the developer's hooks), no slash commands, nothing saved to
 * disk, its own system prompt (so no CLAUDE.md), run from a temp folder. DEVEGGS_SCOUT=1
 * guards against recursion should a hook still fire inside it.
 */
export const askClaude: Ask = (prompt, { model, timeoutMs }) => {
  const args = [
    "-p",
    "--model", model,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--system-prompt", SYSTEM_PROMPT,
  ];
  const r = spawnSync("claude", args, {
    input: prompt,
    cwd: tmpdir(),
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    env: { ...process.env, [GUARD]: "1" },
    maxBuffer: 1024 * 1024,
  });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return { ok: false, error: "claude not found" };
  if (code === "ETIMEDOUT" || r.signal) return { ok: false, error: `timed out after ${timeoutMs} ms` };
  if (r.error) return { ok: false, error: r.error.message };
  if (r.status !== 0) return { ok: false, error: `claude exited ${r.status}: ${(r.stderr || r.stdout).trim().split("\n")[0] ?? ""}` };
  return { ok: true, text: r.stdout };
};

export interface ScoutResult {
  /** Hook stdout; undefined means print nothing. */
  output?: string;
  applied: Applied[];
  error?: string;
  ms: number;
  candidates: number;
}

export interface ScoutDeps {
  items: Egg[];
  ask: Ask;
  env: NodeJS.ProcessEnv;
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
  const done = (rest: Omit<ScoutResult, "ms" | "candidates">, n: number): ScoutResult => ({ ...rest, ms: now() - started, candidates: n });
  let items: Candidate[] = [];
  try {
    items = candidates(deps.items);
    if (!items.length) return done({ applied: [], error: "no eggs or chickens" }, 0);
    let turns: Turn[] = [];
    if (input.transcriptPath && existsSync(input.transcriptPath)) {
      try {
        turns = transcriptTail(readTail(input.transcriptPath));
      } catch {
        turns = []; // no context beats no scout
      }
    }
    // The new prompt may already be the transcript's last line; don't show it twice.
    const last = turns[turns.length - 1];
    const prompt = input.prompt.trim();
    const same = last?.role === "user" && (last.text === prompt || (last.text.endsWith("…") && prompt.startsWith(last.text.slice(0, -1))));
    if (same) turns.pop();
    const model = deps.env["DEVEGGS_SCOUT_MODEL"] || DEFAULT_MODEL;
    const timeoutMs = envInt(deps.env["DEVEGGS_SCOUT_TIMEOUT_MS"], DEFAULT_TIMEOUT_MS);
    const answer = deps.ask(scoutPrompt(input.prompt, turns, items), { model, timeoutMs });
    if (!answer.ok) return done({ applied: [], error: answer.error }, items.length);
    const applied = parseVerdict(answer.text, new Set(items.map((c) => c.id)));
    if (!applied) return done({ applied: [], error: `unparseable reply: ${answer.text.trim().slice(0, 120)}` }, items.length);
    if (!applied.length) return done({ applied }, items.length);
    return done({ applied, output: hookOutput(contextFor(applied, items)) }, items.length);
  } catch (err) {
    return done({ applied: [], error: (err as Error).message }, items.length);
  }
}

/**
 * One JSON line per run in `<basket>/logs/scout.log`, to measure hit rate and latency.
 * logs/ gets its own `.gitignore` so a basket that doesn't ignore it never commits the log.
 */
export function logRun(basket: string, input: HookInput | undefined, result: ScoutResult, at = new Date()): void {
  try {
    const dir = join(basket, "logs");
    mkdirSync(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
    const line = {
      at: at.toISOString(),
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
