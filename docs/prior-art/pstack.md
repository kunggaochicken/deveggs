# Prior art: pstack

[pstack](https://github.com/cursor/plugins/tree/main/pstack) is poteto's Cursor plugin:
one routing skill
([`poteto-mode`](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md)),
twenty-three playbooks, twenty-four one-rule `principle-*` skills, and a delegate
subagent
([`poteto-agent`](https://github.com/cursor/plugins/blob/main/pstack/agents/poteto-agent.md)).
deveggs borrowed four of its ideas and left out the rest on purpose.

## The two at a glance

```text
pstack                                    deveggs
──────                                    ───────
✍️  author writes the principles          🗣  developer says how they like to work
        │                                         │
        ▼                                         ▼
📚 static index in poteto-mode            🥚 egg on trial ──✓✓✓──▶ 🐔 chicken
        │                                         │        └──✗──▶ 💥 cracked
        ▼                                         ▼
🤖 every chat reads the index             🤖 every session loads PREFERENCES.md
```

| | pstack | deveggs |
|---|---|---|
| Where rules come from | Authored by poteto, shipped as a plugin | The developer's own words, laid as eggs |
| How a rule becomes permanent | It ships | 3 ✓ and no ✗ in real use, then the developer hatches it |
| Changing a rule | Edit the skill, open a PR | `deveggs evolve` logs was/now/why and restarts trials |
| Harnesses | Cursor | Any (Claude Code, Codex, …) |

## Adopted

| pstack idea | Where it lives in pstack | What deveggs does now |
|---|---|---|
| ⚡ **Each index line says when it applies.** Entries read "Name. When it applies. Rule." | `poteto-mode` Principles section | `deveggs render` adds a "fires when" column to `PREFERENCES.md`, taken from each item's architecture `Fires when` bullet |
| 🔖 **Cite what you applied.** "Name each principle that shaped a decision and the specific choice it changed. Cite only principles whose leaf SKILL.md you read." | `poteto-mode` Non-negotiables | The rule heads `PREFERENCES.md` and the deveggs skill. A cited egg is also a trial to record with `deveggs feedback` |
| 🤖 **Delegates inherit the style.** `poteto-agent` exists because "substituting `generalPurpose` skips that read and drifts" | `agents/poteto-agent.md` | We tested it instead of assuming (below). No wrapper agent was needed. The skill tells agents to brief the subagents that don't load preferences |
| 🛡 **Encode lessons in structure.** "Encode the rule as a lint, metadata flag, runtime check, or script instead of more text." | `principle-encode-lessons-in-structure` | An item can declare `enforced_by` (a hook, lint or script path) with `deveggs enforce`. `PREFERENCES.md` and `deveggs show` mark it with 🛡 |

### Do subagents inherit preferences?

pstack ships a wrapper agent because Cursor's general agent doesn't read the mode.
We checked deveggs' harnesses on 2026-10-12 by asking each kind of subagent, with no
tools, whether its context held `~/.claude/CLAUDE.md` and that file's `@RTK.md` import:

| Subagent | Global instructions loaded? |
|---|---|
| Claude Code `general-purpose` | ✓ `CLAUDE.md` and its `@` imports |
| Claude Code custom agent (`--agents`) | ✓ `CLAUDE.md` and its `@` imports |
| Claude Code `Explore` | ✗ none |
| Claude Code `Plan` | ✗ none |
| Codex 0.161 `spawn_agent` | ✓ `~/.codex/AGENTS.md`, deveggs block included |

A deveggs wrapper agent would only duplicate what `general-purpose` already gets, and
it can't change what `Explore` and `Plan` load. So `deveggs install` adds no agent
definition. The skill instead tells agents to put the rules that apply into an
`Explore` or `Plan` brief.

## Left out on purpose

| pstack has | Why deveggs doesn't |
|---|---|
| A fixed, authored set of principles | deveggs holds the developer's own rules. A rule earns its place by trial, not by being written down. Borrow someone's rules with `deveggs import`; they arrive as eggs on trial |
| Playbooks that route every task | A playbook is one developer's workflow. In deveggs it's a `workflow` or `skill` egg, tried and hatched like any other |
| Per-role model routing (`/setup-pstack`) | Harness-specific. deveggs stays harness-agnostic |
| "Cite only principles whose leaf you read this session" | deveggs rules are one line each and already in context, so there is no leaf to read. The citation rule keeps "only what actually applied" |
| `/correct` mining history for mistakes | Close to deveggs' trials. deveggs records verdicts as they happen (`deveggs feedback`) rather than mining transcripts later |
