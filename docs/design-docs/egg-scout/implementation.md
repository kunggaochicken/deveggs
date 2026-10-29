# Egg scout: implementation plan

![Prompt to hook to scout claude -p to additionalContext in the main session](diagrams/scout.svg)

## Phases

| Phase | Work | Files | Exit evidence | State |
|---|---|---|---|---|
| 1. Scout command | Hook input parsing, transcript tail, candidates, prompt, injectable `Ask`, verdict validation, hook output, fail-open, recursion guard, log | `src/scout.ts`, `src/cli.ts` | `tests/scout.test.ts` (unit and CLI with a fake `claude`) | ✅ |
| 2. Lightweight install | One managed `UserPromptSubmit` entry in `~/.claude/settings.json`; idempotent; `--dry-run`; exact uninstall | `src/install.ts`, `src/cli.ts` | `tests/install.test.ts` against settings with other tools' hooks | ✅ |
| 3. Docs | INSTALL, README, AGENTS, CONTRIBUTING, SKILL note on the scout block | `*.md`, `skills/deveggs/SKILL.md` | Review | ✅ |
| 4. Measure | `deveggs scout --dry-run` on sample prompts against a real basket; then read `logs/scout.log` after a week of use | — | PR description; follow-up | 🔨 dry runs done, live log pending the developer's `deveggs install` |

## Follow-ups (not in this PR)

| Idea | Why it waits |
|---|---|
| `deveggs scout --stats` summarising `scout.log` (hit rate, p50/p95 latency) | Needs a week of real runs to know what's worth showing |
| Skip the scout for trivial prompts (very short, slash commands) | Measure first: Haiku already returns `[]` quickly |
| Codex / Gemini equivalents | Neither has a prompt-submit hook that can inject context today |

When phase 4 completes, move this package under `docs/design-docs/completed/` and update links to it (`archive-shipped-designs`).
