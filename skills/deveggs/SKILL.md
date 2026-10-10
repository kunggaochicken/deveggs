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

## 🗺 Architecture: every item is drawn

Every egg and chicken carries an `## Architecture` section right after its fact: a
diagram of the preference or workflow it automates, so the developer sees at a glance
what agents will do and can find every file that belongs to it. `deveggs lay` starts it
as a scaffold for the item's kind (placeholders in `‹…›`); **you draw the real one.**

**Hard rule: whenever you present an item to the developer, render its diagram** in a
fenced `text` block: when you propose an egg (before they say yes), after you lay it,
and on every hatch, crack, evolve, rename, import, feedback and verdict card. Never
describe an item without drawing it. `deveggs show <id>` and `deveggs arch <id>` print
it, and `lay`, `feedback`, `evolve`, `rename`, `hatch`, `crack` and `import` print it
after the change.

Scale it to the item:

- **🧠 Preference:** one line, plus when it fires and how it's judged.

  ````markdown
  ```text
  ⚡ PR changes UI ──▶ 🤖 screenshot before & after ──▶ ✅ reviewers see the change
  ```

  - ⚡ **Fires when:** a PR touches anything on screen
  - 🎯 **Judged by:** ✓ reviewers approve without running it · ✗ screenshots of nothing
  ````

- **🔁 Workflow, 📜 script, 🧩 skill:** a component map: what triggers it, the steps,
  each script or skill file by its basket path, inputs and outputs, external systems
  (gh, launchd, harness hooks), and how it relates to other items. End with a
  `### 📁 Files` index (one `` - `path`: what it is `` bullet per file) so it's easy to
  navigate; `deveggs render` links these from `PREFERENCES.md`. A ```` ```mermaid ````
  block may follow the text one for GitHub; terminals show only the text one.

  ````markdown
  ```text
  ⚡ launchd, every 15 s
     │   📥 sysctl: RAM, cores, memory pressure · ps: processes
     ▼
  🛡 scripts/memory-guardian: one pass
     ├──▶ 🔪 runaway dev process (> 25% of RAM)
     ├──▶ 🔪 newest test browsers over budget (1 per 2 cores, 40% of RAM)
     ├──▶ 📤 logs/memory-guardian.log
     └──▶ 🔔 macOS notification

  ✅ the machine stays up while 🤖 subagents fan out
  ```

  - ⚡ **Fires when:** every 15 s, via `scripts/memory-guardian.plist`
  - 🎯 **Judged by:** ✓ no crash, nothing of yours killed · ✗ it kills work you needed
  - 🔗 **Works with:** `delegate-subagents` (more agents, more load)

  ### 📁 Files

  - `scripts/memory-guardian`: one guard pass
  - `scripts/memory-guardian.plist`: the launchd job
  ````

Draw it with `deveggs lay … --arch <file>`, or after laying with
`deveggs arch <id> --set <file>` (`-` reads stdin). Read the scripts and skills you
draw, so paths and steps are accurate. Keep it the first section: no `## ` headings
inside it (use `### `). Every arrow and box must mean something: no filler.

**Emoji vocabulary.** Use the same marks everywhere, so cards read at a glance:

| | Means | | Means |
|---|---|---|---|
| 🥚 🐔 🐣 💥 | egg, chicken, ready, cracked | ⚡ | trigger: what starts it |
| ✓ ✗ | a good or bad trial | 🤖 | the agent acts |
| 🧠 🔁 📜 🧩 | preference, workflow, script, skill | 👤 | the developer acts or decides |
| 🗺 | architecture | ✅ | the outcome it's for |
| 🎯 | how it's judged | 🛡 | a guard or check |
| 🔗 | works with another item | 🌐 | an external system (gh, launchd, a hook) |
| 📁 | files that belong to it | 📥 📤 | inputs, outputs |

## Show, don't tell: visual cards

Every time the basket changes, show the developer **what** changed and **why it
matters** as a visual, not a sentence. A one-line "🥚 laid `x`" leaves them to work out
what the egg will do. A card makes it obvious at a glance. Pick whatever conveys the
meaning most strongly: a table for comparisons and fields, a diagram (in a fenced
block, so it renders in a terminal) for flows, cause and effect, and how eggs relate.
Make it striking, but make every cell and arrow carry meaning. No filler.

### Egg card: on proposal, on lay and on hatch

Show it when you propose an egg (before the developer says yes), right after `lay`, and
on `hatch`. It answers "what will agents do differently now?" It always includes the
item's 🗺 architecture.

```
🥚 memory-guardian                                  📜 script · workflow · ✓0 ✗0
"basically we should have a memory guardian that protects our computer from subagents"

  before:  🤖 subagents spawn ──▶ test browsers pile up ──▶ 💥 machine crashes
  after:   🤖 subagents spawn ──▶ 🛡 guardian culls extras ──▶ ✅ machine stays up

╭─ 🗺  memory-guardian · 📜 script ──────────────────────────────────────
│ ⚡ launchd, every 15 s
│    │   📥 sysctl: RAM, cores, memory pressure · ps: processes
│    ▼
│ 🛡 scripts/memory-guardian: one pass
│    ├──▶ 🔪 runaway dev process (> 25% of RAM)
│    ├──▶ 🔪 newest test browsers over budget (1 per 2 cores, 40% of RAM)
│    ├──▶ 📤 logs/memory-guardian.log
│    └──▶ 🔔 macOS notification
│
│ ✅ the machine stays up while 🤖 subagents fan out
╰────────────────────────────────────────────────────────────────────────
```

| | |
|---|---|
| **Rule** | Run a memory guardian that kills agent-spawned test browsers and runaway dev processes |
| **Fires when** | A test browser count or memory pressure crosses its limit |
| **Before → after** | Machine crashes under subagent load → agents' processes are culled first |
| **Judged by** | ✓ no crash and nothing of yours killed · ✗ it kills work you needed |
| **Works with** | `parallel-subagents` (more agents, more load) |

On hatch, use 🐔 and add its trial record (✓/✗ by harness) to the card.

On evolve, use the item's own mark (🥚 or 🐔, it keeps its tier) and lead with a
was/now/why block, so the developer sees exactly what the agents will do differently.
If the behavior changed, **redraw the architecture** (`deveggs arch <id> --set <file>`)
in the same change and show the new diagram under the block:

```
🥚 terse-summaries  v1 → v2                              preference · comms
"for decisions just give me the options"

  was:  End each turn with a one-line summary
  now:  End each turn with a one-line summary, except when the developer must
        choose: then a table of the options
  why:  narrow: a design review lost its trade-offs (✗ in grover, claude)

  trials:  ✓2 ✗1 (v1) stay in the log · ✓0 ✗0 (v2): 3 ✓ and no ✗ to hatch

╭─ 🗺  terse-summaries · 🧠 preference ────────────────────────────────────────
│ ⚡ end of a turn ──▶ 👤 a choice to make?
│                      ├─ no ──▶ 🤖 one-line summary ──▶ ✅ scannable
│                      └─ yes ─▶ 🤖 table of the options ──▶ ✅ trade-offs kept
╰──────────────────────────────────────────────────────────────────────────────
```

On import, use 🥚 and add a **Borrowed from** row (`<username>`'s basket, and whether it
was their 🐔 chicken or 🥚 egg). The trials always start at ✓0 ✗0: it hasn't been tried
in this developer's loop yet.

### Verdict card: on feedback, crack and hatch-ready

Show it whenever you record a trial (`--good` or `--bad`), propose a crack or propose a
hatch. It answers "why did the egg work or fail **in this scenario**, and how should
the spec change?" Diagnose first, then recommend.

**Before diagnosing, consult the item's architecture and history:** `deveggs arch <id>`
for what it's built to do and which step or file was involved, and `deveggs history <id>`
for its earlier trials and evolutions (did this cause come up before?). Then draw the
architecture with the step where it went right or wrong marked ✓ or ✗:

```
✗ terse-summaries  in a design review (grover, claude)

  egg said:  "end each turn with a one-line summary"
  scenario:  design review with 4 trade-offs to weigh
  result:    summary dropped the trade-offs ──▶ developer asked "what were the options?"
  cause:     the rule has no exception for decisions the developer must make

╭─ 🗺  terse-summaries · 🧠 preference ─────────────────────────────────────
│ ⚡ end of a turn ──▶ 🤖 one-line summary ──▶ ✗ trade-offs lost
│                      ✗ no branch for a 👤 decision the developer must make
╰───────────────────────────────────────────────────────────────────────────
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

Tunings are proposals: **apply them only with the developer's yes.** Record the trial
first, with the card's fields (see "Trying eggs"), then apply the tuning:

- **Narrow, widen or reword** → `deveggs evolve <id> "<new fact>" --quote "<their words>"
  --note "<tuning>: <why>" --harness <you>`, e.g. `--note "narrow: decisions need the
  trade-offs"`. If what it does changed, redraw it with `deveggs arch <id> --set <file>`. Never hand-edit the item file. `evolve` keeps the id, tier, tags and
  history, logs the old and new wording (was/now/why) in it, and restarts the
  trial counts: trials of the old wording stay in the history under their version, but only
  trials since the latest evolve count toward hatching. It works on chickens too (they
  stay chickens), never on cracked items. Then show an egg card with a was/now/why block.
- **Complement** → `deveggs lay` the new egg.
- **Crack** → `deveggs crack <id>`, with the developer's yes.
- **Rename** (the id reads wrong, the rule is fine) → `deveggs rename <old-id> <new-id>`,
  with the developer's yes. Never rename files by hand: `rename` moves the item, its
  history and its skill, repoints harness skill links, rewrites `` `old-id` `` and
  `[[old-id]]` references in other items and logs the old id. Trials and version stay.

## Each item's history

Every item has an append-only history, `<tier>/<id>.history.md` beside it, that
deveggs writes: the lay (the developer's words, harness, repo, session), every trial
with its verdict, every evolve (was/now/why and their words), and every hatch, crack,
rename and import. The item file is only the current rule and its 🗺 architecture. Never
edit either by hand (draw the architecture with `deveggs arch <id> --set <file>`).

```
deveggs history <id>                       # the whole story, oldest first
deveggs history <id> --trials              # just the verdicts
deveggs history <id> --since 2026-10-01 --version 2 --event evolved,hatched
deveggs history <id> --json                # structured, to reason over
```

Use it, don't just write it:

- **Before proposing an evolve, hatch or crack, read the item's history** and cite the
  trials that back the proposal in the verdict card: date, harness, repo, scenario and
  cause (e.g. "✗ 2026-10-09 grover, claude: a new request mid-task was done inline;
  cause too narrow"). Say how many trials each version got, and whether a cause repeats.
- **Let the history shape the tuning.** A cause that recurs across ✗s says what to
  change (the same "too narrow" twice → widen the trigger). ✓s in one kind of scenario
  and ✗s in another → narrow to where it works, or lay a complement for the rest. A
  fact that keeps being reworded → propose wording that covers every past scenario,
  and check it against each logged trial before showing it.
- **Check new wording against old wording.** The evolves list what was tried and why
  it changed. Don't propose a rule the history shows was already tried and failed.
- **Answer "why is this a rule?" from it.** The lay entry holds the developer's own
  words; quote them.

A basket from before history files keeps this in `## Origin`, `## Evolution` and
`## Trials` sections of the item. The first write command (or `deveggs migrate`) moves
them into history files, recovering hatches and cracks from the basket's git log;
`deveggs history` reads either.

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
| (every lay) Draw what it automates | Show the diagram in your proposal, then `--arch <file>` on `lay` (or `deveggs arch <id> --set <file>` after) |
| "Let's try…", "maybe we should…", a new idea to play with | `deveggs lay "<fact>" --id <short-name> --tag <area> --harness <you> --quote "<their words>"` |
| "Always…", "never…": the developer is already sure | `deveggs lay "<fact>" --id <short-name> --chicken --tag <area> --harness <you> --quote "<their words>"` |
| A procedure they keep walking you through | `--kind workflow`, with the steps in `--note` |
| A shell snippet they keep rewriting | `--kind script`, then write `~/.deveggs/scripts/<id>` |
| A workflow that should be its own skill | `--kind skill`, then fill in the generated `SKILL.md` |
| You *noticed* a pattern they never stated | Ask in one line first: "Lay an egg for X?" |

Rules:

- **Use one fact per egg.** Write it as an imperative the next agent can follow.
- **Draw its architecture.** Never leave the `‹…›` scaffold: a one-line flow for a
  preference, a component map with a `### 📁 Files` index for a workflow, script or
  skill (see "🗺 Architecture"). Show it in the proposal, before the developer's yes.
- **Name it with `--id`.** Use 2-4 lowercase words joined by dashes that say what it's
  about, e.g. `pr-ui-screenshots`, not the first words of the fact.
- **Lay only durable, cross-project facts.** Project-specific facts belong in that
  project's own AGENTS.md or CLAUDE.md.
- **Tag private eggs `private`.** If the fact only makes sense on this machine or names
  something not to publish (an account, a person, a client, an internal host or repo,
  a local path or tool), add `--tag private`. `deveggs share` leaves those items and
  their skills out whole. When in doubt, tag it private.
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
  (`# | tier | proposed rule | from your words | tag`), each followed by its one-line
  🗺 diagram, and lay only what they confirm.
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
  trials reset to ✓0 ✗0, their trials left behind, and an `imported` history entry records
  where it came from (their shared history, minus trials, comes along). It copies a skill to `skills/eggs/<id>/` with `[egg: on trial]` on its description.
  It refuses an id already in the basket, and one the developer cracked: cracked items
  are never laid again. If an id clashes but the idea is new, lay it with another `--id` instead.
- After importing, **show an egg card** (with its 🗺 diagram; draw one if it came without) for each item (see "Show, don't tell"). Then
  trial it like any other egg. For a skill, link it into every harness skills folder,
  as when you lay a skill.

## Trying eggs: record feedback

While an egg is on trial, follow it. Record feedback whenever it clearly helps or
gets in the way, **with the verdict card's fields**, so the history holds why, not
just ✓/✗:

```
deveggs feedback <id> --good --harness <you> --scenario "PR summary for a 12-file change" \
  --result "summary was scannable; developer merged without questions"
deveggs feedback <id> --bad --harness <you> \
  --scenario "design review with 4 trade-offs to weigh" \
  --result "summary dropped the trade-offs; developer asked what the options were" \
  --cause "too broad" --tuning "narrow: decisions get a table of options" \
  --quote "what were the options?"
```

| Flag | Put in it |
|---|---|
| `--scenario` | What was going on when the egg applied |
| `--result` | What following it led to, and how the developer reacted |
| `--cause` | For a ✗ (or a mixed ✓): one cause from the table above |
| `--tuning` | The tuning you proposed, and whether the developer said yes |
| `--quote` | The developer's reaction, verbatim |
| `--note` | Anything else worth keeping |

Run it from the project's directory (the repo is picked up), or pass `--repo`; pass
`--session <id>` if your harness has one. Record feedback when there's a real signal, not every time the egg applies. The
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

Get the origin and trials from `deveggs history <id>`, and cite them. Show each egg's 🗺
diagram (`deveggs arch <id>`) under the table so the developer sees what they'd make permanent. Follow the table
with a verdict card for any egg whose trials are mixed, so the developer sees why
before deciding.

- Yes → `deveggs hatch <id> --quote "<their yes>" --harness <you>`. The egg becomes a
  chicken (its history and any skill move along), and the hatch is logged with its trial record.
- No, drop it → `deveggs crack <id> --quote "<their words>" --note "<why>"`. It's kept so it's never laid again.
- Not yet → leave it on trial.
- They reword it → `deveggs evolve` it with their words. It stays on trial for the new
  version unless they also say to hatch it.

**Never hatch, crack or evolve without the developer's say-so.** If an egg is
collecting `--bad` feedback, suggest cracking it or evolving it (with a verdict card
that cites its history). When reviewing the basket, also look at how items are used:
an egg whose ✓s all come from one kind of scenario, or a chicken whose recent trials or
corrections keep naming the same gap, is a candidate to evolve; propose it the same way.

After hatching or cracking a skill, update its symlink in every harness skills
folder that links into the basket (for example `~/.claude/skills/`,
`~/.codex/skills/`). On hatch, repoint the link from `~/.deveggs/skills/eggs/<id>` to
`~/.deveggs/skills/chickens/<id>`. On crack, remove it. Do the same when you lay a
new skill, so every harness can use it. `deveggs rename` repoints these links itself.

## Committing

The basket is its own git repo. `lay`, `feedback`, `evolve`, `rename`, `hatch`, `crack`, `import`
and `render` commit there automatically, so you don't commit basket changes yourself, and nothing
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
