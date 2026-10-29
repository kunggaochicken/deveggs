# Egg scout status

| Component | State | Implemented | Verified | Merged |
|---|---|---|---|---|
| `deveggs scout --hook` / `--dry-run` | ✅ done | Yes | `npm run check`; dry runs on the real basket | #54 |
| Install / uninstall of the Claude Code hook | ✅ done | Yes | Fixture with other tools' `UserPromptSubmit` hooks | #54 |
| Docs and skill note | ✅ done | Yes | Review | #54, this PR |
| Per-harness adapters (Claude Code, Codex) | ✅ done | Yes | Fake `codex` CLI tests; dry runs; a real `codex exec` session with the hook inline | This PR |
| Install / uninstall of the Codex hook (`~/.codex/hooks.json`) | ✅ done | Yes | Fixture with other tools' Codex hooks | This PR |
| Antigravity, Gemini CLI, Cursor | ⬜ not yet | — | [Research](../design.md#harness-research) | — |
| Live measurement, and the Codex `hooks.json` + `/hooks` trust path end to end | ⏸ waits on the developer | — | Needs `deveggs install` on their machine, and the Codex hook trusted in `/hooks` (the hook itself was verified passed inline with `-c`) | — |

## Dry runs (real basket, 27 eggs and chickens, 2026-10-29)

| Prompt | Claude Code (`claude -p`, Haiku) | Codex (`codex exec`, gpt-6-luna) |
|---|---|---|
| "The fix is done and tests pass, ship it." | 3.4 s: `land-via-pr` | 5.8 s: `land-via-pr`, `auto-merge-small-features` |
| "Should we store sessions in Postgres or SQLite for the CLI? Give me options." | 3.4 s: `decision-tables`, `explain-with-diagrams` | 6.4 s: `decision-tables` |
| "what's 2+2" | 2.1 s: nothing (no output) | 4.3 s: nothing (no output) |

A real Codex session (`codex exec` with the hook passed inline via `-c`, nothing written to `~/.codex`) ran the hook, the scout picked `land-via-pr` and `auto-merge-small-features` in 4.1 s, and the main session named both ids from the injected context.

## Next action

| Item | Owner | Next |
|---|---|---|
| Install the hooks on the developer's machine | Developer | `deveggs install --dry-run`, then `deveggs install`, then trust the Codex hook in `/hooks` |
| Read a week of `logs/scout.log` | Agent | Hit rate and p95 latency per harness; decide on `--stats` |
