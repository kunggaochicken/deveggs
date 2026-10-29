# Installing deveggs (instructions for an agent)

You are setting up deveggs for the developer you're working with. The developer
pastes the setup prompt into **one** agent. You wire up **every** coding agent
(harness) on this machine, not only the one you are running in, so they never have to
paste the prompt again. You do the wiring yourself with ordinary file edits and
symlinks. There is no install script. **Stop and ask whenever a step says to
confirm.** deveggs is explicit memory, so nothing changes without the developer's yes.

deveggs is a harness: it guarantees the developer's preferences are loaded at any
point in a session, in code rather than by asking agents to remember them. So the one
step code does for you is loading them (`deveggs install`, step 5). The instruction to
read them is only the fallback, where `deveggs install` can't load them (no global
file, or not yet run).

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
   | Cursor | `~/.cursor` | none: User Rules in Cursor Settings → Rules → User Rules | none: it already reads `~/.claude/skills/` and `~/.codex/skills/`* |
   | Gemini CLI, Antigravity | `~/.gemini` | `~/.gemini/GEMINI.md` (both read it) | `~/.gemini/skills/` (Antigravity: `~/.gemini/antigravity/skills/`) |

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
     the `deveggs:begin` and `deveggs:end` markers), replace it, but keep any
     `deveggs:preferences:begin` … `deveggs:preferences:end` block inside it as it is
     (`deveggs install` below re-checks it either way). Leave the rest of the file
     untouched, and create the file if it doesn't exist.

     ```markdown
     <!-- deveggs:begin -->
     ## deveggs

     My agentic-dev preferences live in a harness-agnostic basket at `~/.deveggs` (`<repo>/bin/deveggs where` prints it).
     - Read `~/.deveggs/PREFERENCES.md` at session start and follow it; it outranks harness-local memory.
     - Use the `deveggs` skill (`<repo>/skills/deveggs/SKILL.md`) when I state or reveal how I like to work: propose eggs (I confirm), record trials.
     <!-- deveggs:end -->
     ```

   - **Load the preferences.** For Claude Code, Codex and Gemini CLI/Antigravity, `<repo>/bin/deveggs install`
     loads `~/.deveggs/PREFERENCES.md` into every session, so no agent has to remember
     to read it: it replaces the block's "Read … at session start" line with a managed
     `deveggs:preferences` block (an `@` import for Claude Code; for Codex, which has
     no imports, and `~/.gemini/GEMINI.md`, whose imports can't reach `~/.deveggs`, the
     preferences inline, re-synced by every `deveggs render`). Include
     the output of `<repo>/bin/deveggs install --dry-run` in the plan. Other harnesses
     keep the read line as the fallback.
   - **The scout hook (Claude Code, Codex and Antigravity).** The same `deveggs install`
     adds one prompt hook to each of these harnesses. The hook is always the harness's
     own; the fresh-context checker is too where the harness has an isolated headless
     mode, so a Codex session never calls Claude. Antigravity has none (`agy -p` saves
     every run as a conversation and runs hooks), so its hook borrows the developer's
     **default scout agent**:

     | Harness | Hook file | Runs on every prompt | Checker |
     |---|---|---|---|
     | Claude Code | `~/.claude/settings.json` (`UserPromptSubmit`) | `<repo>/bin/deveggs scout --hook --harness claude-code` | its own: `claude -p` (Haiku, no tools) |
     | Codex | `~/.codex/hooks.json` (`UserPromptSubmit`) | `<repo>/bin/deveggs scout --hook --harness codex` | its own: `codex exec` (`gpt-6-luna`, ephemeral, read-only sandbox, hooks off) |
     | Antigravity | `~/.gemini/config/hooks.json` (`deveggs-scout` → `PreInvocation`) | `<repo>/bin/deveggs scout --hook --harness antigravity` | the default scout agent's (`claude -p` or `codex exec`) |
     | Gemini CLI, Cursor | — | — | none: Gemini CLI's hook is untested here; Cursor's can't add context, so a default agent can't help it |

     The checker picks the eggs and chickens that fit the prompt, and the hook injects
     them into the session so they get noticed even when the context is busy. It
     leaves every other setting and hook alone, fails open (a slow or failed scout
     never blocks the prompt), adds a few seconds per prompt (about 3 s in Claude Code,
     4–5 s in Codex and Antigravity), and `deveggs uninstall` removes exactly that entry. Rewriting a
     hooks file keeps its indent but normalises its formatting. **Codex runs a new or
     changed hook only once the developer trusts it:** after install, tell them to
     start `codex` and approve it in `/hooks`. Run install from the main deveggs
     checkout, not a worktree: the hook points at the checkout it ran from. Gemini
     CLI and Cursor keep the instruction-only path, and install says why in one line each.
   - **Ask the developer for the default scout agent** when Antigravity is installed
     (`~/.gemini/antigravity-cli`, `~/.gemini/antigravity` or `~/.gemini/config`
     exists). You run install without a terminal, so it can't ask them itself: without
     a saved default or `--scout-default`, it stops before writing anything and prints a
     `needs input:` line naming what it found. Ask instead: list the candidates whose
     CLI is on PATH (`claude` → `claude-code`, `codex` → `codex`) plus `none`, and
     recommend the first one that's signed in (`~/.claude.json` has `oauthAccount`, or
     `~/.codex/auth.json` exists), else the first found. If only one is found, still show
     it and confirm. If neither is, tell them Antigravity gets no scout (preferences
     still load) and pass nothing. Then run `<repo>/bin/deveggs install --scout-default
     <claude-code|codex|none>`. It's saved per machine, in the basket repo's own git
     config (`deveggs.scoutDefault`, never committed), so later installs just show it;
     pass the flag again to change it. `DEVEGGS_SCOUT_DEFAULT` overrides it at hook time.

   Show the developer the whole plan as one list: every harness, every link, every
   file. **Confirm**, then make the changes, then run `<repo>/bin/deveggs install`
   (it renders `~/.deveggs/PREFERENCES.md` first). A harness with no global
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
   - to uninstall, run `deveggs uninstall` (it also removes the scout hooks and the saved default scout agent), then ask any agent to remove the deveggs
     symlinks and the `deveggs:begin` … `deveggs:end` block from each harness
   - to share their basket, `deveggs share --dry-run` shows what would be shared
     and what it redacts; `deveggs share` then opens a PR to
     `kunggaochicken/deveggs-baskets`.
