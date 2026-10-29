# Egg scout: implementation plan

![Each harness: its own prompt hook, the shared scout core, its own headless CLI, injection back into the same session](diagrams/scout.svg)

## Phases

| Phase | Work | Files | Exit evidence | State |
|---|---|---|---|---|
| 1. Scout command | Hook input parsing, transcript tail, candidates, prompt, injectable `Ask`, verdict validation, hook output, fail-open, recursion guard, log | `src/scout.ts`, `src/cli.ts` | `tests/scout.test.ts` (unit and CLI with a fake `claude`) | ✅ #54 |
| 2. Lightweight install | One managed `UserPromptSubmit` entry in `~/.claude/settings.json`; idempotent; `--dry-run`; exact uninstall | `src/install.ts`, `src/cli.ts` | `tests/install.test.ts` against settings with other tools' hooks | ✅ #54 |
| 3. Docs | INSTALL, README, AGENTS, CONTRIBUTING, SKILL note on the scout block | `*.md`, `skills/deveggs/SKILL.md` | Review | ✅ #54 |
| 4. Measure | `deveggs scout --dry-run` on sample prompts against a real basket; then read `logs/scout.log` after a week of use | — | PR description; follow-up | 🔨 dry runs done, live log pending the developer's `deveggs install` |
| 5. Native per harness | Research every harness's prompt hook and headless mode ([table](design.md#harness-research)); split `scout.ts` into a shared core plus an `Adapter` per harness (transcript reader, headless checker, model env, hook output); `--harness` on the hook and the dry run; `harness` in the log; `deveggs install` writes the Codex hook in `~/.codex/hooks.json` with the same guarantees, and says why Gemini and Cursor get none | `src/scout.ts`, `src/install.ts`, `src/cli.ts`, docs | `tests/scout.test.ts` (fake `codex`, Codex rollout fixture), `tests/install.test.ts` (Codex `hooks.json` with other tools' hooks); dry runs on both harnesses; a real `codex exec` session with the hook inline | ✅ this PR |

## Follow-ups (not in this PR)

| Idea | Why it waits |
|---|---|
| `deveggs scout --stats` summarising `scout.log` per harness (hit rate, p50/p95 latency) | Needs a week of real runs to know what's worth showing |
| Skip the scout for trivial prompts (very short, slash commands) | Measure first: both checkers already return `[]` quickly |
| Antigravity adapter (`PreInvocation`, scout on `invocationNum` 0, re-send the cached context as an ephemeral step on later invocations) | `agy -p` saves every run as a conversation and runs hooks; wait for an isolated print mode |
| Gemini CLI adapter (`BeforeAgent`) | Superseded by Antigravity CLI; nothing to test against here |
| Cursor | `beforeSubmitPrompt` can't add context; revisit if it gains `additional_context` |

When phase 4 completes, move this package under `docs/design-docs/completed/` and update links to it (`archive-shipped-designs`).
