---
name: deveggs
description: Use when the developer states or reveals how they like to work with agents ("always…", "never…", "I prefer…", a repeated correction, a workflow or script they keep re-explaining), or asks to remember, review, or hatch their dev preferences. Maintains their harness-agnostic basket of eggs instead of harness-local memory.
---

# deveggs: tend the developer's basket

The developer keeps a **basket**, one git repo of their agentic-dev preferences,
workflows, scripts and skills, which is shared across every harness they use. Your
job is to keep it accurate and growing so they never have to explain the same
preference twice.

The basket's location is in the `deveggs` block of your global instructions. If
that block is missing, use `$DEVEGGS_HOME`. Run all commands through
`<basket-repo>/bin/deveggs`.

## At session start

Read `<basket-repo>/basket/PREFERENCES.md` and follow it. Hatched preferences
outrank harness-local memory. If the two conflict, the basket wins. Tell the
developer about the conflict once.

## When to lay an egg

Lay an egg whenever you learn something durable about *how this developer works*:

| Signal | Command |
|---|---|
| They state it outright: "always…", "never…", "from now on…" | `deveggs lay "<fact>" --explicit --tag <area> --harness <you>` |
| They correct you, and the correction would apply to other projects | `deveggs lay "<fact>" --tag <area> --harness <you> --note "<evidence>"` |
| You notice a pattern they haven't stated | `deveggs lay "<fact>" --harness <you> --note "<evidence>"` (inferred) |
| They re-explain something that's already an egg | `deveggs warm <id> --harness <you>` |
| They keep running the same multi-step procedure | `--kind workflow` |
| They keep writing the same shell snippet | `--kind script` |
| A workflow is solid enough to be a reusable skill | `--kind skill` |

Rules:

- **Use one fact per egg.** Write it as an imperative the next agent can follow, e.g.
  "Land changes through a PR; never push to main".
- **Lay only durable, cross-project facts.** Project-specific facts belong in that
  project's own AGENTS.md or CLAUDE.md.
- **Only explicit statements get `--explicit`.** That flag hatches the egg
  immediately. Never use it for something you inferred.
- **Check before laying.** Run `deveggs list` first. If an egg already covers it,
  `warm` that egg instead of laying a near-duplicate.
- **Lay quietly.** You don't need permission to lay or warm an egg. Mention it in one
  line at the end of your turn, e.g. "🥚 laid `prefers-terse-summaries`".
- **`--harness` is your harness name** (`claude`, `codex`, `cursor`, …). Cross-harness
  sightings are the strongest evidence.

## Hatching (developer confirms)

An inferred egg becomes **warm** 🔥 once it's been seen twice. When `deveggs list --status warm`
shows warm eggs, propose them to the developer at a natural pause, in one batch:

> 🔥 These have come up repeatedly. Should I hatch them?
> 1. `prefers-terse-summaries`: Prefers terse final summaries (×3, claude+codex)

- Yes → `deveggs hatch <id>`. This re-renders PREFERENCES.md.
- No → `deveggs crack <id>`. The egg is kept so it is never laid again.
- They reword it → edit the egg file, then hatch it.

**Never hatch an inferred egg without the developer's confirmation.**

## Growing hatched eggs into artifacts

- **workflow**: once hatched, write the procedure to `basket/workflows/<id>.md`.
- **script**: once hatched, write an executable to `basket/scripts/<id>` with a usage
  comment. Prefer TypeScript run by Node, or POSIX sh.
- **skill**: once hatched, create `basket/skills/<id>/SKILL.md` with `name` and
  `description` frontmatter. Then run `deveggs install` to link it into every harness.

Commit basket changes in the basket repo with a short message such as
`egg: lay prefers-terse-summaries`. Follow the developer's own git preferences in
PREFERENCES.md, for example whether changes go through a PR.

## Pruning

If two eggs overlap, merge them: keep the better wording, sum the sightings, and
crack the other one. If a hatched preference turns out to be wrong, crack it. Don't
leave a stale preference in place.
