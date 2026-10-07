# Installing deveggs (instructions for an agent)

You are installing deveggs for the developer you're working with. deveggs keeps
their agentic-dev preferences in one basket that every harness reads. Follow these
steps in order. **Stop and ask whenever a step says to confirm.** deveggs is
explicit memory, so nothing changes without the developer's yes.

1. **Check prerequisites.** `node --version` must be >= 22.18 and `git` must be on
   PATH. If not, tell the developer what's missing and stop.
2. **Get the code.** If `~/Projects/deveggs` exists, run `git -C ~/Projects/deveggs pull`.
   Otherwise run `git clone https://github.com/kunggaochicken/deveggs ~/Projects/deveggs`.
   If the developer keeps repos somewhere else, ask them where.
3. **Verify.** In that directory run `npm install && npm run check`. If anything
   fails, show the output and stop.
4. **Preview the wiring.** Run `~/Projects/deveggs/bin/deveggs install --dry-run`.
   Show the developer the exact list of planned symlinks and instruction-file
   edits, then **confirm** before going on.
5. **Install.** Run `~/Projects/deveggs/bin/deveggs install`. Suggest adding
   `~/Projects/deveggs/bin` to their PATH. Don't edit their shell profile without
   asking.
6. **Learn the skill.** Read `~/Projects/deveggs/skills/deveggs/SKILL.md` so you know how to
   lay eggs, record trials and propose hatching.
7. **Offer to seed the basket. Don't do it automatically.** Ask whether they want
   to import preferences they've already written down, e.g. their global
   `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`. If they say yes, propose each
   candidate one at a time: suggest a rule, a trigger, and egg or chicken. Lay only
   what they confirm, and pass their original wording as `--quote`.
8. **Report.** Summarize what was linked, which files were edited, and what was laid.
   Mention that `deveggs uninstall` reverts the wiring.
