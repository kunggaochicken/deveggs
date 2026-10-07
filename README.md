# deveggs 🥚

*A basket of eggs for the agentic developer.*

Every developer works with agents differently. Stacks like
[gstack](https://github.com/garrytan/gstack) and
[pstack](https://github.com/cursor/plugins/blob/main/pstack) are great, but they are
*someone else's* loop. Mining your old transcripts for a stack picks up weak, noisy
signals. Harness-local memory (Claude Code memory, Codex memories, Cursor rules, …)
helps, but each harness keeps its own copy and puts its own slant on it.

deveggs is a **meta-skill**. It doesn't hand you a stack. It gives you a place to
build your own: one portable basket that goes into every harness you use.

## Eggs and chickens

```
           lay                  feedback ✓ ✓ ✓             hatch
  idea ─────────▶ 🥚 egg ──────────────────────▶ 🐣 ready ─────────▶ 🐔 chicken
                 (on trial)                                         (permanent)
                     │                                                   │
                     └─────────────── crack ──▶ 💥 cracked ◀── crack ────┘
```

- **🥚 Egg: on trial.** A new preference, workflow, script or skill that you want to
  play with before committing to it. Agents follow it, but every time it clearly
  helps or gets in the way, they record a trial (`deveggs feedback <id> --good|--bad`).
- **🐣 Ready.** The egg has 3 good trials and no bad ones. Agents propose hatching
  it, but only you decide.
- **🐔 Chicken: permanent.** You liked it, so you hatched it. Agents follow it without
  question. Chickens outrank eggs, and both outrank harness-local memory. If you're
  already sure about something ("always…", "never…"), lay it straight as a chicken
  with `--chicken`.
- **💥 Cracked.** Rejected, or a chicken you've retired. It stays on file so it's
  never laid again.

Skills get the same two tiers. **Egg skills** in `basket/skills/eggs/` are
experimental: their description starts with `[egg: on trial]` so agents treat them
that way. **Chicken skills** in `basket/skills/chickens/` are your permanent toolkit.
Hatching a skill moves its folder and removes the trial marker. If a chicken skill
and an egg skill share a name, the chicken wins.

Why trial first? Preferences you *think* you have and preferences that actually
hold up in practice aren't the same. Eggs let you test an idea across real sessions
and harnesses before it becomes part of how every agent works with you. That's a
stronger signal than mining old transcripts.

## Layout

```
AGENTS.md                 canonical instructions for any agent working *in* this repo
skills/deveggs/SKILL.md   the meta-skill: teaches any agent to lay, try, hatch and crack
bin/deveggs               CLI shim -> src/cli.ts (TypeScript, run natively by Node >= 22.18)
src/                      basket model + harness installer (strict tsc, no runtime deps)
tests/                    node:test suites
basket/
  eggs/ chickens/ cracked/         one Markdown file per item; the folder is the tier
  skills/eggs/ skills/chickens/    trial and permanent skills (<id>/SKILL.md)
  scripts/                         scripts that script-kind items point to
  PREFERENCES.md                   generated: chickens, then eggs on trial
```

The basket holds plain Markdown and scripts under git. No database and no harness
lock-in. If you move to a new machine or harness, clone it and run `install`.

## Quickstart

```bash
git clone <your-fork> ~/Projects/deveggs && cd ~/Projects/deveggs
npm install                    # dev-only: typescript + @types/node
npm run check                  # tsc --noEmit (strict) + node --test
export PATH="$PWD/bin:$PATH"

deveggs lay "Land changes through a PR; never push to main" --tag git --chicken   # already sure
deveggs lay "End each turn with a one-line summary" --tag comms --harness claude  # try it out
deveggs feedback end-each-turn-with-a-one-line-summary --good --harness codex --note "kept threads short"
deveggs lay "Release checklist" --kind skill        # egg skill: fill in the generated SKILL.md
deveggs list --tier ready                           # 🐣 eggs with clean trials
deveggs hatch end-each-turn-with-a-one-line-summary # 🥚 -> 🐔
deveggs crack some-bad-idea                         # 💥
deveggs install --dry-run      # preview the harness wiring
deveggs install                # wire the basket into Claude Code / Codex
```

`install` only does two things:

1. It symlinks `skills/deveggs` and every chicken and egg skill into each harness's
   skills directory, and removes links to skills that were cracked.
2. It adds a short managed block (`<!-- deveggs:begin --> … <!-- deveggs:end -->`)
   to each harness's global instructions file, pointing at `PREFERENCES.md`.

It never copies your preferences into a harness. The basket remains the single
source of truth. `deveggs uninstall` removes both.

## Philosophy

- **Try before you commit.** New ideas start as eggs. Only real trials turn them
  into chickens.
- **You hatch, agents don't.** Agents lay eggs and record trials. Only you decide
  what becomes permanent.
- **Harness-agnostic.** Trials record which harness they came from. Nothing belongs
  to any one harness.
- **Grow, don't rehash.** You should never have to explain the same preference to a
  new agent twice.
- **Small eggs.** One fact per egg. Merge and prune freely.
