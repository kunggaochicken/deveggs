# Egg scout: a fresh-context check on every prompt

| Status | Scope | Harness |
|---|---|---|
| Shipped in this PR | `deveggs scout`, the install-managed hook, docs | Claude Code (Codex and Gemini keep the instruction-only path) |

## Principle: deveggs is a harness layer

![Prompt to hook to scout claude -p to additionalContext in the main session](diagrams/scout.svg)

deveggs should act as a thin harness layer: it guarantees your preferences are reliably loaded **and noticed** at any point, by code rather than agent memory. `deveggs install` already guarantees loading (the managed `PREFERENCES.md` block). The scout hook is the second piece and handles attention: once a session's context gets busy, the main agent stops spotting which egg fires, so a fresh-context model checks every prompt and names the items that apply.

## The problem it fixes

| Observed | Cause | Scout's answer |
|---|---|---|
| Eggs rarely fire in long or complex sessions | 20+ rules sit in a big instructions block; attention goes to the task | A separate model sees only the prompt, a short tail and the rules |
| Rules fire inconsistently between turns | Noticing depends on the agent re-reading its context | It runs on every prompt by hook, not by recall |
| No way to tell whether rules are noticed | No measurement | `logs/scout.log`: latency and ids per run |

## How a run works

| Step | What happens | Bound |
|---|---|---|
| 1. Hook input | Claude Code pipes `{prompt, transcript_path, session_id, cwd}` to `deveggs scout --hook` | `UserPromptSubmit`, timeout 15 s |
| 2. Context | New prompt plus the last ≤6 user/assistant text turns (tool calls, results, meta and `<system-reminder>` blocks dropped) | ≤600 chars a turn, ≤3 KB total, reads only the transcript's last 256 KB |
| 3. Candidates | Every egg and chicken: id, tier, fires-when, fact. Cracked items are left out | the whole basket (24 items ≈ 2 K tokens) |
| 4. Ask | `claude -p --model haiku --tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands --no-session-persistence --system-prompt …`, run from a temp dir with `DEVEGGS_SCOUT=1` | 12 s (`DEVEGGS_SCOUT_TIMEOUT_MS`), model `DEVEGGS_SCOUT_MODEL` |
| 5. Verdict | The reply from its first `{` to its last `}` parsed as `{"apply":[{id,why}]}`; unknown or duplicate ids dropped; each `why` flattened to one plain clause (no backticks or angle brackets, ≤160 chars), since the transcript it read may quote untrusted text | — |
| 6. Inject | `hookSpecificOutput.additionalContext`: each id, its fact and why, plus "cite them" and (for eggs) "record the trial" | only when something applies |
| 7. Log | One JSON line in `<basket>/logs/scout.log`; `logs/.gitignore` keeps it out of the basket's git | always, in hook mode |

## Guarantees

| Guarantee | How |
|---|---|
| Never blocks a prompt | Every failure in the process (no `claude`, timeout, non-zero exit, bad JSON, no basket, a throw) prints nothing and exits 0; the hook command adds `2>/dev/null \|\| true`, so a missing checkout or `node` stays silent too |
| No recursion | The child gets `DEVEGGS_SCOUT=1`, and `--setting-sources ""` keeps it from loading the user's hooks at all |
| Cheap and isolated | No tools, MCP, settings, slash commands, CLAUDE.md (own system prompt) or saved session; a fraction of a cent and 2–5 s a prompt on Haiku |
| Lightweight setup | `deveggs install` adds one `hooks.UserPromptSubmit` entry and touches nothing else; `deveggs uninstall` removes exactly it |

## Install footprint

| Situation | install | uninstall |
|---|---|---|
| No `settings.json` | Creates it with only the hook | Deletes the file again |
| Other hooks and keys | Appends one group after them, keeps the file's indent | Removes only its entry; drops a group, array or `hooks` object it left empty |
| Entry already there (moved checkout) | Rewrites its command and timeout in place | — |
| `settings.json` isn't a JSON object, or `hooks` / `hooks.UserPromptSubmit` has an unexpected shape | Skips with a message; never rewrites it | Nothing to do |
| Any rewrite | Atomic (temp file + rename); keeps the indent, but `JSON.stringify` normalises formatting (CRLF becomes LF) | Same |
| Run from a git worktree | Warns: the hook would go quiet once the worktree is removed | — |

The entry is recognised by its command containing `deveggs scout --hook` (settings has no comments to hold markers, and unknown keys could fail Claude Code's settings validation).

## Decisions and alternatives

| Option | Trade-off | Chosen |
|---|---|---|
| Fresh `claude -p` per prompt | 2–5 s added per prompt (12 s worst case on a timeout); reuses the developer's auth with no API key | ✅ judgment needs a model; no runtime deps |
| Keyword or embedding match in-process | Instant, but misses intent ("ship it" → `land-via-pr`) | ✗ |
| `--bare` mode | Fastest startup, but requires `ANTHROPIC_API_KEY` (no OAuth) | ✗ breaks subscription logins |
| Async hook | No latency, but can't inject context into the current turn | ✗ defeats the purpose |
| Dry runs logged | Would skew hit-rate numbers | ✗ only hook runs are logged |

[Implementation plan](implementation.md) · [Status](implementation/status.md)
