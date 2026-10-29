# Egg scout: a fresh-context check on every prompt

| Status | Scope | Harnesses |
|---|---|---|
| Phases 1–3 shipped in #54; phase 5 (native per harness) in this PR | `deveggs scout`, the install-managed hooks, docs | Claude Code and Codex native; Gemini CLI, Antigravity and Cursor not yet (instruction-only) |

## Principle: deveggs is a harness layer, native to each harness

![Each harness: its own prompt hook, the shared scout core, its own headless CLI, injection back into the same session](diagrams/scout.svg)

deveggs acts as a thin harness layer: it guarantees your preferences are reliably loaded **and noticed** at any point, by code rather than agent memory. `deveggs install` guarantees loading (the managed `PREFERENCES.md` block). The scout hook handles attention: once a session's context gets busy, the main agent stops spotting which egg fires, so a fresh-context model checks every prompt and names the items that apply. The scout runs **inside the harness the developer is using**: its own prompt hook, its own headless CLI as the checker. A Codex session is scouted by `codex exec` and never calls Claude.

## The problem it fixes

| Observed | Cause | Scout's answer |
|---|---|---|
| Eggs rarely fire in long or complex sessions | 20+ rules sit in a big instructions block; attention goes to the task | A separate model sees only the prompt, a short tail and the rules |
| Rules fire inconsistently between turns | Noticing depends on the agent re-reading its context | It runs on every prompt by hook, not by recall |
| No way to tell whether rules are noticed | No measurement | `logs/scout.log`: harness, latency and ids per run |
| Only Claude Code sessions were scouted (#54) | The checker was hard-wired to `claude -p` | Per-harness adapters: each harness's hook runs its own CLI |

## Harness research

Verified on this machine (codex-cli 0.161.0, agy 1.4.10, claude, cursor-agent) against each harness's docs, changelog and live probes, 2026-10-29.

| Harness | Prompt hook + config file | Payload (stdin) | Can inject? Format | Headless checker + isolation | Status |
|---|---|---|---|---|---|
| Claude Code | `UserPromptSubmit` in `~/.claude/settings.json` | `prompt`, `transcript_path`, `session_id`, `cwd` | ✅ `hookSpecificOutput.additionalContext` | `claude -p --model haiku --tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands --no-session-persistence --system-prompt …`; the developer's login | ✅ native (#54) |
| Codex CLI | `UserPromptSubmit` in `~/.codex/hooks.json` (same shape as Claude's; `features.hooks`); a new or changed hook runs only once trusted in `/hooks` (Codex keeps its hash in `config.toml`) | `prompt`, `transcript_path`, `session_id`, `cwd`, `turn_id`, `model`, `permission_mode` | ✅ the same `hookSpecificOutput.additionalContext` (plain stdout also works) | `codex exec --ephemeral --ignore-user-config --ignore-rules --disable hooks --sandbox read-only --skip-git-repo-check -c model_reasoning_effort=low -c project_doc_max_bytes=0 --model gpt-6-luna -`; stdout is the final message only; the developer's Codex login (`$CODEX_HOME/auth.json`). No flag drops its tools or system prompt, and `~/.codex/AGENTS.md` still loads | ✅ native (this PR); end-to-end verified in a real `codex exec` session with the hook inline |
| Antigravity CLI (`agy`) | `PreInvocation` in `~/.gemini/config/hooks.json` (`{"<name>": {"PreInvocation": [entry]}}`); fires before **every** model call, `invocationNum` 0 on a new prompt | `lastUserInput`, `invocationNum`, `conversationId`, `transcriptPath`, `modelName`, `workspacePaths` | ✅ `{"injectSteps":[{"ephemeralMessage":…}]}`, verified; but an ephemeral step is gone after the first tool call, so it must be re-sent each invocation | `agy -p --model gemini-3.8-flash-low --disable-slash-commands`: ~5.5 s, ~10 K input tokens. ✗ **not isolated**: no ephemeral flag (every run is saved as a ~450 KB conversation), and hooks run in print mode (verified) with no flag to turn them off | ⬜ not yet: needs an isolated print mode |
| Gemini CLI | `BeforeAgent` in `~/.gemini/settings.json` (timeout in ms) | `prompt`, `session_id`, `transcript_path`, `cwd` | ✅ per docs: `hookSpecificOutput.additionalContext` | `gemini -p` | ⬜ not yet: not installed here, so untestable, and replaced by Antigravity CLI (June 2026) |
| Cursor | `beforeSubmitPrompt` in `~/.cursor/hooks.json` | `prompt`, `attachments` | ✗ output is only `continue` / `user_message`; `additional_context` exists only on `sessionStart` and tool hooks | `cursor-agent -p` | ⬜ not yet: the prompt hook can't add context |

The scout picks the harness from an explicit `--harness` flag the installed hook passes; it never guesses from the environment. A hook without the flag (installed by #54) is Claude Code's.

## How a run works

| Step | What happens | Bound |
|---|---|---|
| 1. Hook input | The harness pipes `{prompt, transcript_path, session_id, cwd, …}` to `deveggs scout --hook --harness <h>` | `UserPromptSubmit`, timeout 15 s |
| 2. Context | New prompt plus the last ≤6 user/assistant text turns, read by the harness's reader: Claude Code transcript lines (tool calls, results, meta and `<system-reminder>` blocks dropped); Codex rollout `item_completed` `UserMessage`/`AgentMessage` items (the format is undocumented, so any other shape reads as no context) | ≤600 chars a turn, ≤3 KB total, reads only the transcript's last 256 KB |
| 3. Candidates | Every egg and chicken: id, tier, fires-when, fact. Cracked items are left out | the whole basket (27 items ≈ 2 K tokens) |
| 4. Ask | The harness's own checker (research table), run from a temp dir with `DEVEGGS_SCOUT=1` | 12 s (`DEVEGGS_SCOUT_TIMEOUT_MS`); model `DEVEGGS_SCOUT_<CLAUDE\|CODEX>_MODEL`, else `DEVEGGS_SCOUT_MODEL`, else the harness default |
| 5. Verdict | The reply from its first `{` to its last `}` parsed as `{"apply":[{id,why}]}`; unknown or duplicate ids dropped; each `why` flattened to one plain clause (no backticks or angle brackets, ≤160 chars), since the transcript it read may quote untrusted text | — |
| 6. Inject | The harness's hook output (Claude Code and Codex share `hookSpecificOutput.additionalContext`): each id, its fact and why, plus "cite them" and (for eggs) "record the trial" | only when something applies |
| 7. Log | One JSON line in `<basket>/logs/scout.log`, with `harness`; `logs/.gitignore` keeps it out of the basket's git | always, in hook mode |

## Adapters

| Part | Shared core (harness-agnostic) | Adapter (per harness) |
|---|---|---|
| Input | `parseHookInput` | — (Claude Code and Codex send the same fields) |
| Transcript | `readTail`, trimming | `transcriptTail` / `codexTranscriptTail` |
| Question | `candidates`, `scoutPrompt`, `SYSTEM_PROMPT` | how the instruction reaches the model (`--system-prompt`, or leading the stdin for Codex) |
| Checker | `runHeadless`: temp cwd, guard env, timeout, error text | `askClaude` / `askCodex`, default model, model env var |
| Verdict | `parseVerdict`, `cleanWhy`, `contextFor` | — |
| Output | fail open, `logRun` | `output` (both use `hookOutput`) |

Adding a harness means an `Adapter` in `ADAPTERS` (`src/scout.ts`) and a `hook` in its `SPECS` entry (`src/install.ts`), and only when its hook can inject context and its headless mode can run isolated.

## Guarantees

| Guarantee | How |
|---|---|
| Native to the harness | The installed hook names its harness; the scout asks only that harness's CLI, with its own login. No harness calls another's model |
| Never blocks a prompt | Every failure in the process (no CLI, timeout, non-zero exit, bad JSON, no basket, an unknown `--harness`, a throw) prints nothing and exits 0; the hook command adds `2>/dev/null \|\| true`, so a missing checkout or `node` stays silent too |
| No recursion | The child gets `DEVEGGS_SCOUT=1`; on top, Claude Code's `--setting-sources ""` and Codex's `--disable hooks` keep the developer's hooks from loading in it |
| Cheap and isolated | Claude Code: no tools, MCP, settings, slash commands, CLAUDE.md or saved session (2–3.5 s). Codex: no saved session, config, hooks or execpolicy; read-only sandbox; low reasoning (4–6.5 s, ~6.5 K tokens, mostly Codex's own system prompt) |
| Lightweight setup | `deveggs install` adds one `hooks.UserPromptSubmit` entry per harness and touches nothing else; `deveggs uninstall` removes exactly it |

## Install footprint

| Situation | install | uninstall |
|---|---|---|
| No hooks file (`settings.json`, `hooks.json`) | Creates it with only the hook | Deletes the file again |
| Other hooks and keys | Appends one group after them, keeps the file's indent | Removes only its entry; drops a group, array or `hooks` object it left empty |
| Entry already there (moved checkout, or a #54 hook without `--harness`) | Rewrites its command and timeout in place | — |
| The file isn't a JSON object, or `hooks` / `hooks.UserPromptSubmit` has an unexpected shape | Skips with a message; never rewrites it | Nothing to do |
| Any rewrite | Atomic (temp file + rename); keeps the indent, but `JSON.stringify` normalises formatting (CRLF becomes LF) | Same |
| Codex | Says the hook runs once trusted in `/hooks` (Codex skips new or changed hooks until then) | Codex keys trust by hook position: removing the scout's group can ask the developer to re-trust a group added after it |
| A harness without a scout hook (Gemini) | One line saying why | — |
| Run from a git worktree | Warns: the hook would go quiet once the worktree is removed | — |

The entry is recognised by its command containing `deveggs scout --hook` (JSON has no comments to hold markers, and unknown keys could fail a harness's settings validation).

## Decisions and alternatives

| Option | Trade-off | Chosen |
|---|---|---|
| Each harness's own headless CLI | Needs an adapter per harness; reuses each harness's auth, no API keys | ✅ native, no cross-vendor calls |
| One checker (`claude -p`) for every harness | One code path, but a Codex developer may have no Claude login, and it sends Codex prompts to another vendor | ✗ (the developer's ask) |
| Detect the harness from env vars | No flag, but guesses can misfire (nested harnesses, `CLAUDE_*` aliases in other harnesses' hooks) | ✗ explicit `--harness` |
| Antigravity via `PreInvocation` + cached re-injection | Hook and injection work, but every `agy -p` run is saved as a conversation and runs hooks | ✗ until `agy` has an isolated print mode |
| Keyword or embedding match in-process | Instant, but misses intent ("ship it" → `land-via-pr`) | ✗ |
| Async hook | No latency, but can't inject context into the current turn | ✗ defeats the purpose |
| Dry runs logged | Would skew hit-rate numbers | ✗ only hook runs are logged |

[Implementation plan](implementation.md) · [Status](implementation/status.md)
