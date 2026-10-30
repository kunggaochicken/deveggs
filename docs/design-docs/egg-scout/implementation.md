# Egg scout: implementation plan

![Per harness: the native trigger code runs, the scout it starts, and how the answer is injected](diagrams/scout-native.svg)

## Phases

| Phase | Work | Files | Exit evidence | State |
|---|---|---|---|---|
| 1. Scout command | Hook input parsing, transcript tail, candidates, prompt, injectable `Ask`, verdict validation, hook output, fail-open, recursion guard, log | `src/scout.ts`, `src/cli.ts` | `tests/scout.test.ts` (unit and CLI with a fake `claude`) | ✅ #54 |
| 2. Lightweight install | One managed `UserPromptSubmit` entry in `~/.claude/settings.json`; idempotent; `--dry-run`; exact uninstall | `src/install.ts`, `src/cli.ts` | `tests/install.test.ts` against settings with other tools' hooks | ✅ #54 |
| 3. Docs | INSTALL, README, AGENTS, CONTRIBUTING, SKILL note on the scout block | `*.md`, `skills/deveggs/SKILL.md` | Review | ✅ #54 |
| 4. Measure | `deveggs scout --dry-run` on sample prompts against a real basket; then read `logs/scout.log` after a week of use | — | PR description; follow-up | 🔨 dry runs done, live log pending the developer's `deveggs install` |
| 5. Native per harness | Research every harness's prompt hook and headless mode ([table](design.md#harness-research)); split `scout.ts` into a shared core plus an `Adapter` per harness (transcript reader, headless checker, model env, hook output); `--harness` on the hook and the dry run; `harness` in the log; `deveggs install` writes the Codex hook in `~/.codex/hooks.json` with the same guarantees, and says why Gemini and Cursor get none | `src/scout.ts`, `src/install.ts`, `src/cli.ts`, docs | `tests/scout.test.ts` (fake `codex`, Codex rollout fixture), `tests/install.test.ts` (Codex `hooks.json` with other tools' hooks); dry runs on both harnesses; a real `codex exec` session with the hook inline | ✅ #55 |
| 6. Default scout agent | Split hook from checker: `Checker` (`CHECKERS`) apart from `Adapter`, `resolveChecker` (native, else `DEVEGGS_SCOUT_DEFAULT`, else the saved default); the Antigravity adapter (`PreInvocation` input, transcript reader, `injectSteps` output, check on invocation 0 and re-send the cached context after); `deveggs install` writes its hook in `~/.gemini/config/hooks.json` under `deveggs-scout` with the same guarantees, and asks for the default (prompt at a terminal, `--scout-default`, `needs input:` otherwise); saved per machine as `deveggs.scoutDefault` in the basket's git config, removed by uninstall; `checker` in the log | `src/scout.ts`, `src/install.ts`, `src/store.ts`, `src/cli.ts`, docs | `tests/scout.test.ts` (Antigravity payload and transcript fixtures, fallback choice, re-send, fail open), `tests/install.test.ts` (hooks.json with other tools' named hooks, prompt with injected input, flag, non-TTY message, storage, uninstall, dry run); the hook path with fixture payloads on the real basket with each default agent; the prompt under a real PTY | ✅ #56 |
| 7. Each harness's own subagent | Research per harness whether code can start the harness's own subagent ([table](design.md#phase-7-the-scout-as-each-harnesss-own-subagent)); Claude Code: the deveggs mod (`plugins/claude-code/`: register a hidden tool-less `deveggs-scout`, spawn it on every prompt, read its handback, inject within 5 s or append later, mark the fallback hook's input); `deveggs scout --subagent spec\|ask\|verdict`; the fallback hook stays silent when marked; `deveggs install` links the plugin into `~/.claude/skills/deveggs-scout` (idempotent, repoints a moved checkout, leaves anything else alone, uninstall removes only its link); `bin/deveggs` resolves its checkout physically (`cd -P`) so a linked plugin finds it. Codex, Antigravity, Cursor keep their fallback, with the reasons | `plugins/claude-code/`, `src/scout.ts`, `src/install.ts`, `src/cli.ts`, `bin/deveggs`, docs | `tests/mod.test.ts` (the mod against a fake mods API and the real CLI), `tests/scout.test.ts` (`--subagent`, the mark), `tests/install.test.ts` (the link); live `claude -p --plugin-dir` runs on a copy of the real basket in auto mode; a live Codex gate run in a throwaway `CODEX_HOME` | ✅ this PR |

## Follow-ups (not in this PR)

| Idea | Why it waits |
|---|---|
| `deveggs scout --stats` summarising `scout.log` per harness (hit rate, p50/p95 latency) | Needs a week of real runs to know what's worth showing |
| Skip the scout for trivial prompts (very short, slash commands) | Measure first: both checkers already return `[]` quickly |
| Antigravity's own checker | `agy -p` saves every run as a conversation and runs hooks; switch from the default agent once it has an isolated print mode |
| Live Antigravity session with the hook installed | Waits on the developer's `deveggs install` (the hook path was verified with fixture payloads) |
| Gemini CLI adapter (`BeforeAgent`, checked by the default agent) | Superseded by Antigravity CLI; hook enablement and transcript format undocumented; nothing to test against here |
| Cursor | `beforeSubmitPrompt` does add context in the TUI (not `-p`); first check whether the Claude Code hook it imports from `~/.claude/settings.json` already scouts there, then decide between its own hook and a gate |
| Codex app-server scout thread | A code-started native Codex thread (own system prompt, output schema, tools off), but 5.7 s cold vs ~4 s for `codex exec`; worth it with a warm daemon, or if injecting into the running TUI thread works |
| Antigravity or Cursor native subagent + gate | Needs a live session signed in through the keychain, which the developer must OK; Codex's gate ran the scout in only 1 of 3 turns |

When phase 4 completes, move this package under `docs/design-docs/completed/` and update links to it (`archive-shipped-designs`).
