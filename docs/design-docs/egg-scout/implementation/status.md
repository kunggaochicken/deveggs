# Egg scout status

| Component | State | Implemented | Verified | Merged |
|---|---|---|---|---|
| `deveggs scout --hook` / `--dry-run` | ✅ done | Yes | `npm run check`; dry runs on the real basket | In this PR |
| Install / uninstall of the hook | ✅ done | Yes | Fixture with other tools' `UserPromptSubmit` hooks | In this PR |
| Docs and skill note | ✅ done | Yes | Review | In this PR |
| Live measurement | ⏸ waits on the developer | — | Needs `deveggs install` on their machine | — |

## Dry runs (real basket, 24 eggs and chickens, Haiku, 2026-10-29)

| Prompt | Latency | Picked |
|---|---|---|
| "Should we store sessions in Postgres or SQLite …? Give me options." | 4.8 s | `decision-tables`, `cite-applied-rules` |
| "The fix is done and tests pass, ship it." | 3.2 s | `land-via-pr` |
| "Design the onboarding screens … so I can show my team." | 3.8 s | `shareable-ui-mockups`, `delegate-subagents`, `explain-with-diagrams` |
| "what's 2+2" | 2.4 s | nothing (no output) |

## Next action

| Item | Owner | Next |
|---|---|---|
| Install the hook on the developer's machine | Developer | `deveggs install --dry-run`, then `deveggs install` |
| Read a week of `logs/scout.log` | Agent | Hit rate and p95 latency; decide on `--stats` |
