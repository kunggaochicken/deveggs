---
name: deveggs
description: Use when the developer states or reveals how they like to work with agents ("always…", "never…", "let's try…", "I prefer…", a correction that applies beyond this project, a workflow, script or skill they keep re-explaining), when an on-trial egg clearly helps or hurts, when they ask to review, hatch or crack their preferences, or when they want ideas or to borrow from other developers' shared baskets. Tends their harness-agnostic basket of eggs (on trial) and chickens (permanent) instead of harness-local memory.
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

## Show, don't tell: visual cards

Every time the basket changes, show the developer **what** changed and **why it
matters** as a visual, not a sentence. A one-line "🥚 laid `x`" leaves them to work out
what the egg will do. A card makes it obvious at a glance. Pick whatever conveys the
meaning most strongly: a table for comparisons and fields, a diagram (in a fenced
block, so it renders in a terminal) for flows, cause and effect, and how eggs relate.
Make it striking, but make every cell and arrow carry meaning. No filler.

### Egg card: on lay and on hatch

Show it right after `lay` or `hatch`. It answers "what will agents do differently now?"

```
🥚 memory-guardian                                   script · workflow · ✓0 ✗0
"basically we should have a memory guardian that protects our computer from subagents"

  subagents spawn ──▶ test browsers ──▶ memory pressure ──▶ 💥 machine crashes
  Chrome, node, vite      pile up           rises                (before)

  subagents spawn ──▶ 🛡 guardian checks ──▶ kills extras ──▶ ✅ machine stays up
                         every 15 s          and runaways         (after)
```

| | |
|---|---|
| **Rule** | Run a memory guardian that kills agent-spawned test browsers and runaway dev processes |
| **Fires when** | A test browser count or memory pressure crosses its limit |
| **Before → after** | Machine crashes under subagent load → agents' processes are culled first |
| **Judged by** | ✓ no crash and nothing of yours killed · ✗ it kills work you needed |
| **Works with** | `parallel-subagents` (more agents, more load) |

On hatch, use 🐔 and add its trial record (✓/✗ by harness) to the card.

On import, use 🥚 and add a **Borrowed from** row (`<username>`'s basket, and whether it
was their 🐔 chicken or 🥚 egg). The trials always start at ✓0 ✗0: it hasn't been tried
in this developer's loop yet.

### Verdict card: on feedback, crack and hatch-ready

Show it whenever you record a trial (`--good` or `--bad`), propose a crack or propose a
hatch. It answers "why did the egg work or fail **in this scenario**, and how should
the spec change?" Diagnose first, then recommend.

```
✗ terse-summaries  in a design review (grover, claude)

  egg said:  "end each turn with a one-line summary"
  scenario:  design review with 4 trade-offs to weigh
  result:    summary dropped the trade-offs ──▶ developer asked "what were the options?"
  cause:     the rule has no exception for decisions the developer must make
```

| # | Tuning | Change to the egg spec | Captures |
|---|---|---|---|
| 1 | **Narrow** (recommended) | "…one-line summary, **except** when the developer must choose: then a table of the options" | this ✗ without losing the ✓s |
| 2 | **Complement** | Lay `decision-tables`: "show choices as a table of trade-offs" | the decision case, as its own egg |
| 3 | **Crack** | Retire it | only if the ✗s keep coming |

Diagnose with these causes, and name the one that fits:

| Cause | Looks like | Usual tuning |
|---|---|---|
| Too broad | Fired where it doesn't belong | Narrow: add a scope or an exception |
| Too narrow | Didn't fire where it should have | Widen the trigger |
| Ambiguous wording | Two agents read it differently | Reword as one concrete imperative |
| Missing companion | Right rule, but a gap next to it | Lay a complementary egg |
| Conflicts with another egg | Two eggs pulled opposite ways | Merge them, or rank one above the other |
| Wrong tier | Proven but still on trial, or failing as a chicken | Hatch, or crack |

When several eggs bear on the scenario, draw how they relate: which complement each
other, which conflict, and which one should give way. Batch several recordings into
one card table rather than one card each.

Tunings are proposals: **apply them only with the developer's yes.** Reword or narrow
→ edit the egg's first body line in `<basket>/eggs/<id>.md`, keep its trials, and run
`deveggs render`. Complement → `deveggs lay` the new egg. Then record the tuning:
`deveggs feedback <id> --note "tuned: <what changed and why>"` with the trial's
`--good`/`--bad`.

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

## Borrowing from shared baskets

Other developers share their baskets in
[kunggaochicken/deveggs-baskets](https://github.com/kunggaochicken/deveggs-baskets)
(`baskets/<github-username>/`). When the developer wants ideas ("how do others…",
"anything good for PR reviews?") or names something to borrow, browse it. Both commands
only read that repo.

| Want | Command |
|---|---|
| Which baskets exist | `deveggs browse` |
| One developer's eggs and chickens | `deveggs browse <username>` |
| Items on a topic, across every basket | `deveggs browse --tag <t>` or `--kind <k>` |
| Borrow one | `deveggs import <username>/<id>` |

- **Propose before importing.** Show the candidates as one table
  (`# | their tier | id | fact | from`), saying which ones the developer's basket already
  covers (`deveggs list`). Import only what they confirm, one `import` per item.
- `import` adds it as a 🥚 egg, never a chicken, even if it was a chicken for its owner:
  trials reset to ✓0 ✗0, the trial log cleared, and an Origin row records where it came
  from. It copies a skill to `skills/eggs/<id>/` with `[egg: on trial]` on its description.
  It refuses an id already in the basket, and one the developer cracked: cracked items
  are never laid again. If an id clashes but the idea is new, lay it with another `--id` instead.
- After importing, **show an egg card** for each item (see "Show, don't tell"). Then
  trial it like any other egg. For a skill, link it into every harness skills folder,
  as when you lay a skill.

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
Show each recording as a verdict card (see "Show, don't tell"), batched into one table
when there are several.

## Hatching: the developer decides

`deveggs list --tier ready` shows eggs with enough clean good trials (🐣). At a
natural pause, propose them in one batch:

> 🐣 These eggs have been working well. Should I hatch them into chickens?
>
> | # | egg | rule | trials | from your words |
> |---|---|---|---|---|
> | 1 | `terse-summaries` | End each turn with a one-line summary | ✓4 ✗0 (claude, codex) | "can you just give me one line at the end" (grover, 2026-10-06) |

Get the origin and trial log from `deveggs show <id>`. Follow the table with a verdict
card for any egg whose trials are mixed, so the developer sees why before deciding.

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
run `deveggs share --dry-run` and show the developer its preview (what's shared, what
was redacted). Only run `deveggs share` once they've reviewed it and said yes, and
never pass `--yes` for them.
