# Installing deveggs (instructions for an agent)

You are setting up deveggs for the developer you're working with. The developer
pastes the setup prompt into **one** agent. You wire up **every** coding agent
(harness) on this machine, not only the one you are running in, so they never have to
paste the prompt again. You do the wiring yourself with ordinary file edits and
symlinks. There is no install script. **Stop and ask whenever a step says to
confirm.** deveggs is explicit memory, so nothing changes without the developer's yes.

1. **Check prerequisites.** `node --version` must be >= 22.18 and `git` must be on
   PATH. If not, tell the developer what's missing and stop.
2. **Get the repo.** Ask where they keep repos (default `~/Projects`).
   - If `<dir>/deveggs` exists, run `git -C <dir>/deveggs pull` and skip to the
     last bullet.
   - Otherwise, `git clone https://github.com/kunggaochicken/deveggs <dir>/deveggs`.
     A plain clone: deveggs is only the tool, and `git pull` updates it.
   - Run `npm install && npm run check` inside it. If anything fails, show the
     output and stop.

   Below, `<repo>` is the absolute path of the clone.
3. **Set up the basket.** The developer's basket lives outside the repo, in
   `~/.deveggs/` (`<repo>/bin/deveggs where` prints the path). If `$DEVEGGS_BASKET`
   is set, use that path wherever this guide says `~/.deveggs`. The basket is its own
   git repo, and every deveggs command commits to it locally.
   - If `<repo>/my-basket/` holds an old basket (anything besides `.gitkeep`
     files), **confirm**, then run `<repo>/bin/deveggs migrate --relink`. It moves the
     basket into `~/.deveggs/`, keeps its git history and repoints harness skill links
     into the old path.
   - Otherwise, if `~/.deveggs/` doesn't exist, ask whether they already have a
     basket repo on GitHub (for example from another machine). If so, clone it:
     `git clone https://github.com/<user>/my-basket ~/.deveggs`. Step 8 offers to
     keep it synced.
   - Otherwise, there's nothing to do yet. The first deveggs command that writes
     creates it (folders, a README and `git init`), and `deveggs render` in step 5
     does that.
4. **Find every harness.** Look in the developer's home directory for each harness
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

5. **Plan, then confirm.** For each harness found, plan these two changes:
   - **Skill links.** Symlink `<repo>/skills/deveggs` to `<skills>/deveggs`. Also
     link each folder in `~/.deveggs/skills/chickens/` and
     `~/.deveggs/skills/eggs/` by its folder name. If a chicken and an egg
     share a name, link the chicken. Skip any path that already exists and isn't a
     symlink into `<repo>` or `~/.deveggs`. Never overwrite a skill deveggs doesn't
     own. Skip this change if the harness has no skills folder.
   - **The deveggs prompt.** Add this block to the end of its global
     instructions file, filling in `<repo>`. If the block already exists (between
     the `deveggs:begin` and `deveggs:end` markers), replace it. Leave the rest of the
     file untouched, and create the file if it doesn't exist.

     ```markdown
     <!-- deveggs:begin -->
     ## deveggs

     My agentic-dev preferences live in a harness-agnostic basket at `~/.deveggs` (`<repo>/bin/deveggs where` prints it).
     - Read `~/.deveggs/PREFERENCES.md` at session start and follow it; it outranks harness-local memory.
     - Use the `deveggs` skill (`<repo>/skills/deveggs/SKILL.md`) when I state or reveal how I like to work: propose eggs (I confirm), record trials.
     <!-- deveggs:end -->
     ```

   Show the developer the whole plan as one list: every harness, every link, every
   file. **Confirm**, then make the changes. Run `<repo>/bin/deveggs render` so
   `~/.deveggs/PREFERENCES.md` exists and is current. A harness with no global
   instructions file (Cursor) needs one manual step: give the developer the block to paste into its settings.
   That is the only paste left.
6. **Learn the skill.** Read `<repo>/skills/deveggs/SKILL.md` so you know how to lay
   eggs, record trials and propose hatching.
7. **Offer to seed the basket. Don't do it automatically.** Ask whether they want to
   import preferences from the instructions files you just found. Mention that
   community baskets can be browsed with `<repo>/bin/deveggs browse` and borrowed from
   with `<repo>/bin/deveggs import <username>/<id>`. If they say
   yes, propose each candidate one at a time: suggest a rule, a trigger, and egg or
   chicken. Lay only what they confirm, and pass their original wording as `--quote`.
8. **Offer to save the basket on GitHub and keep it synced.** Until it's pushed, the
   basket lives only on this machine. Run `<repo>/bin/deveggs autopush status`.
   - If it says `no remote yet`, offer to run `<repo>/bin/deveggs push`. It creates a
     private repo, `my-basket` by default (`--repo <owner>/<name>` to choose), on
     their GitHub account and pushes to it. **Confirm** first. If they'd rather wait,
     tell them any agent can run it later, for example after their first few eggs.
   - Once it has a remote (just pushed, or cloned in step 3) and autopush is `off`,
     offer to run `<repo>/bin/deveggs autopush on`: every change to the basket is then
     pushed to GitHub as it happens, so it stays synced across machines. **Confirm**
     first. `deveggs autopush off` turns it off again.
9. **Report.** List the harnesses you wired and anything you skipped. Mention that:
   - every wired agent picks up deveggs in its next session. They don't need to
     paste anything again, though they can for a harness they install later.
   - `git -C <repo> pull` gets tool updates without touching their basket,
     `deveggs browse` shows what others have shared, and `deveggs push` backs the
     basket up (automatically after every change once `deveggs autopush on` is set)
   - on a new machine, clone their basket repo into `~/.deveggs/` and follow this
     guide again
   - to uninstall, ask any agent to remove the deveggs symlinks and the
     `deveggs:begin` … `deveggs:end` block from each harness
   - to share their basket, `deveggs share --dry-run` shows what would be shared
     and what it redacts; `deveggs share` then opens a PR to
     `kunggaochicken/deveggs-baskets`.
