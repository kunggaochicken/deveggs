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
   - If `<dir>/deveggs` exists, run `git -C <dir>/deveggs pull`.
   - Otherwise run `git clone https://github.com/kunggaochicken/deveggs <dir>/deveggs`
     and then `npm install && npm run check` inside it. If anything fails, show the
     output and stop.

   A plain clone is all you need. No fork. Below, `<repo>` is the absolute path of
   that clone.
3. **Find every harness.** Look in the developer's home directory for each harness
   below. A harness counts as installed if its home folder exists. Also include any
   other coding agent you know is installed: you know its global instructions file
   and skills folder better than this list does.

   | Harness | Home | Global instructions | Global skills |
   | --- | --- | --- | --- |
   | Claude Code | `~/.claude` | `~/.claude/CLAUDE.md` | `~/.claude/skills/` |
   | Codex | `~/.codex` | `~/.codex/AGENTS.md` | `~/.codex/skills/` |
   | Cursor | `~/.cursor` | none: User Rules in Cursor Settings → Rules | `~/.cursor/skills/` |
   | Gemini CLI | `~/.gemini` | `~/.gemini/GEMINI.md` | none |

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
     - Use the `deveggs` skill (`<repo>/skills/deveggs/SKILL.md`) when I state or reveal how I like to work: propose eggs (I confirm), record trials.
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
   - `git pull` gets tool updates and new shared baskets without touching `my-basket/`
   - to uninstall, ask any agent to remove the deveggs symlinks and the
     `deveggs:begin` … `deveggs:end` block from each harness
   - to share their basket, they can open a PR with a reviewed copy in
     `shared-baskets/<username>/`. GitHub creates the fork for them.

Optional: to sync `my-basket/` across machines, fork the repo, remove the
`my-basket` lines from `.gitignore` in the fork, and commit it there.
