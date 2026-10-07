# Installing deveggs (instructions for an agent)

You are setting up deveggs for the developer you're working with, in whatever harness
you are running in (Claude Code, Codex, Cursor, …). They paste the same
prompt into each agent they use. The first one clones the repo and wires up every
harness the CLI knows. Later ones only need to wire themselves if the CLI doesn't
know them. **Stop and ask whenever a step says to confirm.** deveggs is explicit
memory, so nothing changes without the developer's yes.

1. **Check prerequisites.** `node --version` must be >= 22.18 and `git` must be on
   PATH. If not, tell the developer what's missing and stop.
2. **Get the repo.** Ask where they keep repos (default `~/Projects`).
   - If `<dir>/deveggs` exists, another harness already cloned it: run
     `git -C <dir>/deveggs pull`.
   - Otherwise run `git clone https://github.com/kunggaochicken/deveggs <dir>/deveggs`
     and then `npm install && npm run check` inside it. If anything fails, show the
     output and stop.

   A plain clone is all you need. No fork.
3. **Wire up the harnesses.** Run `<dir>/deveggs/bin/deveggs install --dry-run`, show
   the developer the plan, **confirm**, then run `<dir>/deveggs/bin/deveggs install`.
   It links the deveggs skill into every harness it knows (Claude Code, Codex) and
   prints the deveggs prompt. If you are running in a harness it didn't wire, do what
   the output says: add that prompt to your own global instructions file, or give it
   to the developer to paste. If you have a global skills folder, also symlink
   `<dir>/deveggs/skills/deveggs` into it.
4. **Learn the skill.** Read `<dir>/deveggs/skills/deveggs/SKILL.md` so you know how
   to lay eggs, record trials and propose hatching.
5. **Offer to seed the basket. Don't do it automatically.** Ask whether they want to
   import preferences from this harness's instructions file. Mention that
   `shared-baskets/` has community baskets they can borrow eggs from. If they say
   yes, propose each candidate one at a time: suggest a rule, a trigger, and egg or
   chicken. Lay only what they confirm, and pass their original wording as `--quote`.
6. **Report.** Say what you changed, and tell them to paste the same prompt into any
   other agent they use. Mention that:
   - `git pull` gets tool updates and new shared baskets without touching `my-basket/`
   - `deveggs uninstall` reverts the wiring. For other harnesses, delete the
     deveggs prompt (`deveggs:begin` … `deveggs:end`) from their instructions.
   - to share their basket, they can open a PR with a reviewed copy in
     `shared-baskets/<username>/`. GitHub creates the fork for them.

Optional: to sync `my-basket/` across machines, fork the repo, remove the
`my-basket` lines from `.gitignore` in the fork, and commit it there.
