# Egg scout status

| Component | State | Implemented | Verified | Merged |
|---|---|---|---|---|
| `deveggs scout --hook` / `--dry-run` | ✅ done | Yes | `npm run check`; dry runs on the real basket | #54 |
| Install / uninstall of the Claude Code hook | ✅ done | Yes | Fixture with other tools' `UserPromptSubmit` hooks | #54 |
| Docs and skill note | ✅ done | Yes | Review | #54, this PR |
| Per-harness adapters (Claude Code, Codex) | ✅ done | Yes | Fake `codex` CLI tests; dry runs; a real `codex exec` session with the hook inline | #55 |
| Install / uninstall of the Codex hook (`~/.codex/hooks.json`) | ✅ done | Yes | Fixture with other tools' Codex hooks | #55 |
| Default scout agent (prompt, `--scout-default`, `needs input:`, saved per machine, uninstall) | ✅ done | Yes | Fixtures; the prompt under a real PTY in a throwaway HOME | This PR |
| Antigravity adapter + hook (`~/.gemini/config/hooks.json`), via the default agent | ✅ done | Yes | Fixtures with other tools' named hooks; the hook path with fixture payloads on the real basket, each default agent | This PR |
| Claude Code mod: its own scout subagent, spawned by code (`plugins/claude-code/`, linked by install) | ✅ done | Yes | `tests/mod.test.ts`; live `claude -p --plugin-dir` runs (below) | This PR |
| Fallback hook silent while the mod scouts (`deveggs_scout` mark) | ✅ done | Yes | Live: the marked stdin reached the hook, which printed nothing and never ran `claude -p` | This PR |
| Codex / Antigravity native subagent + gate | ⏸ not shipped | — | Codex: live gate run, scout ran in 1 of 3 turns; Antigravity: needs a keychain login ([why](../design.md#phase-7-the-scout-as-each-harnesss-own-subagent)) | — |
| Gemini CLI, Cursor | ⬜ not yet | — | [Research](../design.md#harness-research) | — |
| Live measurement, and the Codex `hooks.json` + `/hooks` trust path end to end | ⏸ waits on the developer | — | Needs `deveggs install` on their machine, and the Codex hook trusted in `/hooks` (the hook itself was verified passed inline with `-c`) | — |

## Claude Code's scout subagent, live (a copy of the real basket, 27 eggs and chickens, `claude -p --plugin-dir`, auto mode, 2026-10-30)

| Prompt | Scout (subagent, Haiku) | Main answer |
|---|---|---|
| "Use no tools. The fix is done and tests pass; should I ship it?" | 1.6 s: `land-via-pr`, `auto-merge-small-features` (in time: added to the prompt) | Cited `land-via-pr` |
| "Use no tools. Should we store sessions in Postgres or SQLite…" | 4.1 s: nothing | — |
| "Use no tools. What's the status of the three subagents you launched?" | 4.2 s: `progress-diagrams` | — |
| "Use no tools. Explain in one line how the scout's design fits together." | 5.1 s: `explain-with-diagrams` (late: appended) | — |
| "what's 2+2" | 2.3–2.4 s: nothing | "4", no mention of the scout |

Earlier runs, before the mod answered the scout's `SubagentHandback` itself, showed the leak it fixes: the main model read the raw `{"apply":[]}` report as a message and replied to it. The same prompts through the `claude -p` fallback took 3.0–3.3 s.

## Dry runs (real basket, 27 eggs and chickens, 2026-10-29)

| Prompt | Claude Code (`claude -p`, Haiku) | Codex (`codex exec`, gpt-6-luna) |
|---|---|---|
| "The fix is done and tests pass, ship it." | 3.4 s: `land-via-pr` | 5.8 s: `land-via-pr`, `auto-merge-small-features` |
| "Should we store sessions in Postgres or SQLite for the CLI? Give me options." | 3.4 s: `decision-tables`, `explain-with-diagrams` | 6.4 s: `decision-tables` |
| "what's 2+2" | 2.1 s: nothing (no output) | 4.3 s: nothing (no output) |

A real Codex session (`codex exec` with the hook passed inline via `-c`, nothing written to `~/.codex`) ran the hook, the scout picked `land-via-pr` and `auto-merge-small-features` in 4.1 s, and the main session named both ids from the injected context.

## Antigravity hook path (fixture `PreInvocation` payloads, a copy of the real basket, 27 eggs and chickens, 2026-10-29)

| Prompt | Default `claude-code` (`claude -p`, Haiku) | Default `codex` (`codex exec`, gpt-6-luna) |
|---|---|---|
| "ship it, open the PR" | 5.0 s: `land-via-pr`, `deveggs-github-account` | 4.3 s: `land-via-pr` |
| "should we use postgres or sqlite for the cache? give me the options" | 3.1 s: `decision-tables` | 3.5 s: `decision-tables` |
| "what's the status of the three subagents you launched?" | 2.3 s: `progress-diagrams` | 3.8 s: `progress-diagrams` |
| "fix the typo in README line 3" | 4.1 s: `delegate-subagents`, `land-via-pr`, `absolute-file-paths` | 4.3 s: nothing (no output) |

Each run printed one `injectSteps` ephemeral step (when something applied) and logged `"checker":"fallback:<agent>"`. The same turn's `invocationNum` 1 re-sent the identical output in ~0.1 s without a second check.

## Next action

| Item | Owner | Next |
|---|---|---|
| Install the hooks on the developer's machine | Developer | `deveggs install --dry-run`, then `deveggs install` (pick the default scout agent), then trust the Codex hook in `/hooks` |
| Read a week of `logs/scout.log` | Agent | Hit rate and p95 latency per harness; decide on `--stats` |
