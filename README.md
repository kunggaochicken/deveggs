# deveggs 🥚

*A basket of eggs for the agentic developer.*

Every developer works with agents differently. Stacks like [gstack](https://github.com/garrytan/gstack) and
[pstack](https://github.com/cursor/plugins/blob/main/pstack) are great, but they are *someone else's* loop. Mining your old transcripts for a stack
picks up weak, noisy signals. Harness-local memory (Claude Code memory, Codex
memories, Cursor rules, …) helps, but each harness keeps its own copy and puts its
own slant on it.

deveggs is a **meta-skill**. It doesn't hand you a stack. It gives you a place to
build your own: one portable basket of eggs that goes into every harness you use.

```
  lay ──▶ 🥚 egg ──warm──▶ 🥚🔥 warm egg ──hatch──▶ 🐣 hatched ──▶ rendered into every harness
            │                                         │
            └──────────── crack (rejected) ◀──────────┘
```

- **Egg.** A raw observation about how you work: a preference, a correction, a
  workflow, a script you keep rewriting. It's cheap to lay and not trusted yet.
- **Warm.** The same thing came up again, maybe in a different harness. Each
  sighting is recorded.
- **Hatch.** *You* confirm it. Explicit statements ("always…", "never…") hatch
  right away. Inferred ones wait until you sign off. This is the key difference
  from transcript mining: what you say on purpose beats what an agent guesses.
- **Crack.** Rejected. A cracked egg stays on file so it isn't laid again.

Hatched eggs grow into real things:

| kind         | hatches into                                  |
|--------------|-----------------------------------------------|
| `preference` | a line in `basket/PREFERENCES.md`             |
| `workflow`   | a procedure in `basket/workflows/`            |
| `script`     | an executable in `basket/scripts/`            |
| `skill`      | a `SKILL.md` folder in `basket/skills/`       |

## Layout

```
AGENTS.md                 canonical instructions for any agent working *in* this repo
skills/deveggs/SKILL.md   the meta-skill: teaches any agent how to lay/warm/hatch eggs
bin/deveggs               CLI shim -> src/cli.ts (TypeScript, run natively by Node >= 22.18)
src/                      basket model + harness installer (strict tsc, no runtime deps)
tests/                    node:test suites
basket/
  eggs/                   one Markdown file per egg (frontmatter = state)
  PREFERENCES.md          generated from hatched preference eggs
  skills/ scripts/ workflows/   hatched artifacts you carry around
```

The basket holds plain Markdown and scripts under git. No database and no harness
lock-in. If you move to a new machine or harness, clone it and run `install`.

## Quickstart

```bash
git clone <your-fork> ~/Projects/deveggs && cd ~/Projects/deveggs
npm install                    # dev-only: typescript + @types/node
npm run check                  # tsc --noEmit (strict) + node --test
export PATH="$PWD/bin:$PATH"

deveggs lay "Always land changes through a PR, never push to main" --tag git --explicit
deveggs lay "Prefers terse final summaries" --tag comms --harness claude
deveggs warm prefers-terse-final-summaries --harness codex
deveggs list
deveggs hatch prefers-terse-final-summaries
deveggs render                 # rebuild basket/PREFERENCES.md
deveggs install --dry-run      # preview the harness wiring
deveggs install                # wire the basket into Claude Code / Codex / AGENTS.md
```

`install` only does two things:

1. It symlinks `skills/deveggs` and every hatched skill into each harness's skills
   directory.
2. It adds a short managed block (`<!-- deveggs:begin --> … <!-- deveggs:end -->`)
   to each harness's global instructions file, pointing at `PREFERENCES.md`.

It never copies your preferences into a harness. The basket remains the single
source of truth. `deveggs uninstall` removes both.

## Philosophy

- **Explicit beats inferred.** An agent may *lay* an egg on its own, but only you
  can hatch an inferred one.
- **Harness-agnostic.** Eggs record which harness they came from. They don't belong
  to any one harness.
- **Grow, don't rehash.** You should never have to explain the same preference to a
  new agent twice.
- **Small eggs.** One fact per egg. Merge and prune freely.
