---
name: deveggs
description: Use when the developer states or reveals how they like to work with agents ("always…", "never…", "let's try…", "I prefer…", a correction that applies beyond this project, a workflow, script or skill they keep re-explaining), when an on-trial egg clearly helps or hurts, or when they ask to review, hatch or crack their preferences. Tends their harness-agnostic basket of eggs (on trial) and chickens (permanent) instead of harness-local memory.
---

# deveggs: tend the developer's basket

The developer keeps a **basket**: one git repo holding their agentic-dev preferences,
workflows, scripts and skills. Every harness they use reads the same basket. It has
two tiers:

- 🥚 **Eggs are on trial.** These are new ideas the developer wants to play with
  before committing. Follow them, but watch how they go.
- 🐔 **Chickens are permanent.** These are eggs the developer liked enough to hatch.
  Follow them without question.

A chicken outranks an egg, and both outrank harness-local memory.

The basket's location is in the `deveggs` block of your global instructions. If
that block is missing, use `$DEVEGGS_HOME`. Run all commands through
`<basket-repo>/bin/deveggs`.

## At session start

Read `<basket-repo>/my-basket/PREFERENCES.md`. It lists the chickens, then the eggs with
their ids. Skills from both tiers are already installed. Egg skills have descriptions
that start with `[egg: on trial]`.

## Laying eggs

| Signal | Command |
|---|---|
| "Let's try…", "maybe we should…", a new idea to play with | `deveggs lay "<fact>" --tag <area> --harness <you> --quote "<their words>"` |
| "Always…", "never…": the developer is already sure | `deveggs lay "<fact>" --chicken --tag <area> --harness <you> --quote "<their words>"` |
| A procedure they keep walking you through | `--kind workflow`, with the steps in `--note` |
| A shell snippet they keep rewriting | `--kind script`, then write `my-basket/scripts/<id>` |
| A workflow that should be its own skill | `--kind skill`, then fill in the generated `SKILL.md` |
| You *noticed* a pattern they never stated | Ask in one line first: "Lay an egg for X?" |

Rules:

- **Use one fact per egg.** Write it as an imperative the next agent can follow.
- **Lay only durable, cross-project facts.** Project-specific facts belong in that
  project's own AGENTS.md or CLAUDE.md.
- **Don't duplicate.** Run `deveggs list` first. If an egg already covers it, record
  feedback on that egg instead of laying a new one.
- **`--chicken` needs an explicit "always/never".** Never use it for something you inferred.
- **Always record the origin.** `--quote` is the developer's own words, verbatim, not
  your paraphrase. Run `lay` from the project's directory so the repo is picked up
  automatically, or pass `--repo`. Pass `--session <id>` if your harness exposes one.
  The origin is what the developer reads when deciding whether to hatch.

## Trying eggs: record feedback

While an egg is on trial, follow it. Record feedback whenever it clearly helps or
gets in the way:

```
deveggs feedback <id> --good --harness <you> --note "made the PR summary scannable"
deveggs feedback <id> --bad  --harness <you> --note "too terse for a design review"
```

Record feedback when there's a real signal, not every time the egg applies. The
developer's reactions count most: if they push back on behavior an egg caused,
that's a `--bad`. Feedback from more than one harness is the strongest evidence.
Mention each recording in one line at the end of your turn, e.g. "🥚 +1 `terse-summaries`".

## Hatching: the developer decides

`deveggs list --tier ready` shows eggs with enough clean good trials (🐣). At a
natural pause, propose them in one batch:

> 🐣 These eggs have been working well. Should I hatch them into chickens?
> 1. `terse-summaries`: End each turn with a one-line summary (✓4 ✗0, claude+codex)
>    from: "can you just give me one line at the end" (grover, 2026-10-06)

Get the origin and trial log from `deveggs show <id>`.

- Yes → `deveggs hatch <id>`. The egg becomes a chicken, and a skill moves to `skills/chickens/`.
- No, drop it → `deveggs crack <id>`. It's kept so it's never laid again.
- Not yet → leave it on trial.
- They reword it → edit the egg file, then hatch it.

**Never hatch or crack without the developer's say-so.** If an egg is collecting
`--bad` feedback, suggest cracking it or rewording it.

After hatching or cracking a skill, run `deveggs install` so every harness picks up
the change.

## Committing

`my-basket/` is gitignored by default, so basket changes stay local and there's
nothing to commit. If the developer forked deveggs and un-ignored `my-basket/` to sync
it, commit there with messages like `egg: lay terse-summaries`,
`chicken: hatch terse-summaries` or `crack: tabs`, following their own git chickens.
Never commit `my-basket/` to `kunggaochicken/deveggs` itself. To share, follow
`shared-baskets/README.md`.
