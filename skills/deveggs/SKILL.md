---
name: deveggs
description: Use when the developer states or reveals how they like to work with agents ("always…", "never…", "let's try…", "I prefer…", a correction that applies beyond this project, a workflow, script or skill they keep re-explaining), when an on-trial egg clearly helps or hurts, or when they ask to review, hatch or crack their preferences. Tends their harness-agnostic basket of eggs (on trial) and chickens (permanent) instead of harness-local memory.
---

# deveggs: tend the developer's basket

The goal is to capture the developer eggsperience, how they like to work with agents,
so any agent can reproduce it just the way they want. It's refined by trial and error:
eggs are tried, and only what proves itself is kept.

The developer keeps a **basket**: one git repo holding their agentic-dev preferences,
workflows, scripts and skills. Every harness they use reads the same basket. It has
two tiers:

- 🥚 **Eggs are on trial.** These are new ideas the developer wants to play with
  before committing. Follow them, but watch how they go.
- 🐔 **Chickens are permanent.** These are eggs the developer liked enough to hatch.
  Follow them without question.

A chicken outranks an egg, and both outrank harness-local memory.

The basket lives in `~/.deveggs/` (`$DEVEGGS_BASKET` overrides it; `deveggs where`
prints it), apart from the deveggs repo that holds the tool. The deveggs prompt in
your global instructions says where that repo is. If the prompt is missing, use
`$DEVEGGS_HOME`. Run all commands through `<deveggs-repo>/bin/deveggs`.

## Presenting to the developer

Show proposals (eggs to lay, hatch candidates, a basket overview) as a Markdown table,
not a list, marked with 🥚 egg, 🐔 chicken, 🐣 ready, 💥 cracked, and ✓/✗ for trials:

| # | tier | proposed rule | from your words | tag |
|---|---|---|---|---|
| 1 | 🥚 | Draw a diagram when explaining something complex | "we should draw a visual diagram for it" | explaining |
| 2 | 🐔 | Never push to main | "never push to main" | git |

## At session start

Read `~/.deveggs/PREFERENCES.md` (or `PREFERENCES.md` in the folder `deveggs where`
prints). It lists the chickens, then the eggs with their ids. Skills from both tiers are already installed. Egg skills have descriptions
that start with `[egg: on trial]`.

## Laying eggs

Spot preferences yourself, as the developer works. They never have to ask you to
look. Corrections, "always/never", "let's try…" and steps they repeat are all
signals. But **never lay without their yes**: propose each one in one line (or a
table, for several) and lay only what they confirm.

| Signal | Command |
|---|---|
| "Let's try…", "maybe we should…", a new idea to play with | `deveggs lay "<fact>" --id <short-name> --tag <area> --harness <you> --quote "<their words>"` |
| "Always…", "never…": the developer is already sure | `deveggs lay "<fact>" --id <short-name> --chicken --tag <area> --harness <you> --quote "<their words>"` |
| A procedure they keep walking you through | `--kind workflow`, with the steps in `--note` |
| A shell snippet they keep rewriting | `--kind script`, then write `~/.deveggs/scripts/<id>` |
| A workflow that should be its own skill | `--kind skill`, then fill in the generated `SKILL.md` |
| You *noticed* a pattern they never stated | Ask in one line first: "Lay an egg for X?" |

Rules:

- **Use one fact per egg.** Write it as an imperative the next agent can follow.
- **Name it with `--id`.** Use 2-4 lowercase words joined by dashes that say what it's
  about, e.g. `pr-ui-screenshots`, not the first words of the fact.
- **Lay only durable, cross-project facts.** Project-specific facts belong in that
  project's own AGENTS.md or CLAUDE.md.
- **Don't duplicate.** Run `deveggs list` first. If an egg already covers it, record
  feedback on that egg instead of laying a new one.
- **`--chicken` needs an explicit "always/never".** Never use it for something you inferred.
- **Always record the origin.** `--quote` is the developer's own words, verbatim, not
  your paraphrase. Run `lay` from the project's directory so the repo is picked up
  automatically, or pass `--repo`. Pass `--session <id>` if your harness exposes one.
  The origin is what the developer reads when deciding whether to hatch.

## When invoked explicitly (`/deveggs`)

The developer may call you directly with `/deveggs` (or "deveggs: …"). Auto-detection
above still applies the rest of the time.

- **With text** (`/deveggs always draw a diagram…`): it's their own preference. Run
  `deveggs list` to dedupe, draft one egg (a chicken if it says always/never), pass
  their words verbatim as `--quote`, confirm in one line and lay.
- **Without text**: scan this session for anything that reflects a recurring pattern
  in how they work: corrections, instructions they repeated or re-specified,
  always/never statements, workflows they walked you through, and standards they
  held you to. Propose candidates as one table
  (`# | tier | proposed rule | from your words | tag`) and lay only what they confirm.
  Also show any hatch-ready eggs (`deveggs list --tier ready`).

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
>
> | # | egg | rule | trials | from your words |
> |---|---|---|---|---|
> | 1 | `terse-summaries` | End each turn with a one-line summary | ✓4 ✗0 (claude, codex) | "can you just give me one line at the end" (grover, 2026-10-06) |

Get the origin and trial log from `deveggs show <id>`.

- Yes → `deveggs hatch <id>`. The egg becomes a chicken, and a skill moves to `skills/chickens/`.
- No, drop it → `deveggs crack <id>`. It's kept so it's never laid again.
- Not yet → leave it on trial.
- They reword it → edit the egg file, then hatch it.

**Never hatch or crack without the developer's say-so.** If an egg is collecting
`--bad` feedback, suggest cracking it or rewording it.

After hatching or cracking a skill, update its symlink in every harness skills
folder that links into the basket (for example `~/.claude/skills/`,
`~/.codex/skills/`). On hatch, repoint the link from `~/.deveggs/skills/eggs/<id>` to
`~/.deveggs/skills/chickens/<id>`. On crack, remove it. Do the same when you lay a
new skill, so every harness can use it.

## Committing

The basket is its own git repo. `lay`, `feedback`, `hatch`, `crack` and `render`
commit there automatically, so you don't commit basket changes yourself, and nothing
is lost even offline. Nothing pushes unless the developer chose it: **never push
without the developer's yes.** `deveggs autopush status` shows where things stand.
If the basket has no remote yet, you may offer `deveggs push`, which saves it to a
private GitHub repo on their account. If it has a remote and autopush is off, you may
offer `deveggs autopush on`; never turn it on without their yes. With autopush on,
every command that changes the basket also pushes it, so you don't push yourself. If
a push fails (offline, auth), the change is still committed locally; `deveggs push`
catches up later. Never commit a basket to `kunggaochicken/deveggs` itself. To share,
follow `shared-baskets/README.md`.
