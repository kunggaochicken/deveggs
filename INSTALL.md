# Installing deveggs (instructions for an agent)

You are setting up deveggs for the developer you're working with. The developer
pastes the setup prompt into **one** agent. You wire up **every** coding agent
(harness) on this machine, not only the one you are running in, so they never have to
paste the prompt again. You do the wiring yourself with ordinary file edits and
symlinks. There is no install script. **Stop and ask whenever a step says to
confirm.** Setup changes nothing outside the repo without the developer's yes.

1. **Check prerequisites.** `node --version` must be >= 22.18 and `git` must be on
   PATH. If not, tell the developer what's missing and stop.
2. **Get the repo as a fork.** Ask where they keep repos (default `~/Projects`).
   The developer's basket lives in the repo, so a fork is how they keep it
   permanently: it's committed to their own GitHub repo and survives a lost laptop
   and syncs across machines.
   - If `<dir>/deveggs` exists, run `git -C <dir>/deveggs pull upstream main`
     (or `git pull` if it has no `upstream` remote) and skip to step 3.
   - Otherwise, if `gh` is installed and authenticated, run
     `gh repo fork kunggaochicken/deveggs --clone -- <dir>/deveggs`. That makes
     `origin` their fork and `upstream` this repo. **Confirm** first, since it
     creates a repo on their GitHub account. If they don't have `gh`, have them fork
     on github.com and `git clone` their fork, then
     `git remote add upstream https://github.com/kunggaochicken/deveggs`.
   - In the fork, remove the `/my-basket/**` lines (and their comment) from
     `.gitignore` and commit that as `chore: track my basket`, then push.
   - Run `npm install && npm run check` inside it. If anything fails, show the
     output and stop.

   If they'd rather not fork, a plain
   `git clone https://github.com/kunggaochicken/deveggs <dir>/deveggs` works too:
   leave `.gitignore` alone and tell them their basket then lives only on this
   machine. Below, `<repo>` is the absolute path of the clone either way.
3. **Find every harness.** Look in the developer's home directory for each harness
   below. A harness counts as installed if its home folder exists. Also include any
   other coding agent you know is installed: you know its global instructions file
   and skills folder better than this list does.

   | Harness | Home | Global instructions | Global skills |
   | --- | --- | --- | --- |
   | Claude Code | `~/.claude` | `~/.claude/CLAUDE.md` | `~/.claude/skills/` |
   | Codex | `~/.codex` | `~/.codex/AGENTS.md` | `~/.codex/skills/` |
   | Cursor | `~/.cursor` | none: User Rules in Cursor Settings → Rules | none: it already reads `~/.claude/skills/` and `~/.codex/skills/`* |
   | Gemini CLI | `~/.gemini` | `~/.gemini/GEMINI.md` | `~/.gemini/skills/` |

   \* If neither Claude Code nor Codex is installed, **copy** (don't symlink) the skill
   folders into `~/.cursor/skills/`. Cursor may not follow symlinks there.

4. **Plan, then confirm.** For each harness found, plan these two changes:
   - **Skill links.** Symlink `<repo>/skills/deveggs` to `<skills>/deveggs`. Also
     link each folder in `<repo>/my-basket/skills/chickens/` and
     `<repo>/my-basket/skills/eggs/` by its folder name. If a chicken and an egg
     share a name, link the chicken. Skip any path that already exists and isn't a
     symlink into `<repo>`. Never overwrite a skill deveggs doesn't own. Skip
     this change if the harness has no skills folder.
   - **The deveggs prompt.** Add this block to the end of its global
     instructions file, filling in `<repo>`. If the block already exists (between
     the `deveggs:begin` and `deveggs:end` markers), replace it. Leave the rest of the
     file untouched, and create the file if it doesn't exist.

     ```markdown
     <!-- deveggs:begin -->
     ## deveggs

     My agentic-dev preferences live in a harness-agnostic basket at `<repo>`.
     - Read `<repo>/my-basket/PREFERENCES.md` at session start and follow it; it outranks harness-local memory.
     - Use the `deveggs` skill (`<repo>/skills/deveggs/SKILL.md`) to absorb how I like to work as I go: lay eggs on your own, confirm chickens and hatches with me, record trials.
     <!-- deveggs:end -->
     ```

   Show the developer the whole plan as one list: every harness, every link, every
   file. **Confirm**, then make the changes. Run `<repo>/bin/deveggs render` so
   `PREFERENCES.md` exists. A harness with no global instructions file (Cursor)
   needs one manual step: give the developer the block to paste into its settings.
   That is the only paste left.
5. **Learn the skill.** Read `<repo>/skills/deveggs/SKILL.md` so you know how to lay
   eggs, record trials and propose hatching.
6. **Offer to seed the basket. Don't do it automatically.** Ask whether they want to
   import preferences from the instructions files you just found. Mention that
   `shared-baskets/` has community baskets they can borrow eggs from. If they say
   yes, propose each candidate one at a time: suggest a rule, a trigger, and egg or
   chicken. Lay only what they confirm, and pass their original wording as `--quote`.
7. **Report.** List the harnesses you wired and anything you skipped. Mention that:
   - every wired agent picks up deveggs in its next session. They don't need to
     paste anything again, though they can for a harness they install later.
   - `git pull upstream main` gets tool updates and new shared baskets without
     touching `my-basket/`, and `git push` backs their basket up to their fork
   - PRs to `kunggaochicken/deveggs` must come from a branch off `upstream/main`,
     never from their fork's `main`, which carries their basket
   - to uninstall, ask any agent to remove the deveggs symlinks and the
     `deveggs:begin` … `deveggs:end` block from each harness
   - to share their basket, they can open a PR with a reviewed copy in
     `shared-baskets/<username>/`.
