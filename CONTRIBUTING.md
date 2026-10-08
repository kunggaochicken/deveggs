# Contributing to deveggs

Thanks for helping. deveggs is small on purpose, so most contributions are a short
PR: a fix to the tool, a clearer instruction for agents, or a basket you chose to share.

## What lives here, and what doesn't

This repo is the deveggs **code**:

- `src/` and `bin/deveggs`: the CLI (`lay`, `feedback`, `hatch`, `crack`, `render`,
  `push`, `autopush`, `share`, `migrate`, …).
- `skills/deveggs/SKILL.md`: the meta-skill that teaches any agent to tend a basket.
- `INSTALL.md`: the instructions an agent follows to wire deveggs into every harness.
- `templates/`: files new baskets start with.
- `shared-baskets/`: baskets people chose to publish.
- `tests/`: the test suite.

Your **personal basket** is data, not code. It lives in `~/.deveggs/` (or
`$DEVEGGS_BASKET`; `deveggs where` prints it) as its own git repo, and is never
committed here. `my-basket/` is the legacy in-checkout location: it stays gitignored,
never `git add -f` it, and CI rejects anything committed under it.

## Dev setup

You need Node >= 22.18 (see `engines` in `package.json`) and git.

```bash
git clone https://github.com/kunggaochicken/deveggs
cd deveggs
npm install
npm run check   # tsc --noEmit + node --test
```

Run `npm run check` before every PR. Node runs `src/*.ts` directly through type
stripping, so there is no build step:

- **Erasable syntax only.** No `enum`, `namespace` or constructor parameter properties.
- **Import local files with the `.ts` extension.**
- **No runtime dependencies.** The only dev dependencies are `typescript` and
  `@types/node`. Use Node's standard library.
- TypeScript is strict (`tsconfig.json`).

Tests must never touch your real `~/.deveggs`. CLI tests run in a throwaway HOME,
checkout and basket from `tests/sandbox.ts`; use it for anything that runs the CLI or git.

## Where changes go

| Change | Where |
|---|---|
| The egg model: kinds, tiers, trials, hatch readiness, rendering `PREFERENCES.md` | `src/basket.ts` |
| Basket git operations: commit, push, autopush | `src/store.ts` |
| CLI commands and flags | `src/cli.ts` |
| Terminal output (`list`, `show`, tables) | `src/view.ts`, `src/table.ts` |
| Moving a legacy `my-basket/` | `src/migrate.ts` |
| `deveggs share`: what is shared, redacted or left out, and the PR it opens | `src/share.ts` |
| Harness wiring (Claude Code, Codex, Cursor, …) | `INSTALL.md`, as instructions, not code. Add a harness by adding a row to its table. |
| How agents spot, lay, trial, hatch and present eggs | `skills/deveggs/SKILL.md` |
| Tests | `tests/<module>.test.ts` |

If you change a command's behavior, update the README, `SKILL.md` and `INSTALL.md`
wherever they describe it, in the same PR.

## Sharing your basket

Shared baskets live in their own repo,
[kunggaochicken/deveggs-baskets](https://github.com/kunggaochicken/deveggs-baskets), under
`baskets/<your-github-username>/`. Share yours with `deveggs share`, starting with a dry run:

```bash
deveggs share --dry-run --as <your-github-username>   # preview: nothing leaves your machine
deveggs share --as <your-github-username>             # branch, commit, confirm, push, open the PR
```

It builds a sanitized copy of your basket and prints, per item, what it shares and what
it removed or redacted. Nothing is pushed until you confirm (or pass `--yes`). It clones
the baskets repo into a temp folder and commits only `baskets/<you>/`, so your personal
basket is never committed. If you can't push to the repo, it pushes to your fork.

What it does by default:

| | |
|---|---|
| **Shared** | Chickens and eggs (id, kind, tags, trial counts, dates and the fact), and their skills |
| **Removed** | Origin quotes (`--keep-quotes` keeps them, redacted), `context` rows (date · harness · repo · session), harnesses, notes and the `## Trials` log |
| **Redacted** in everything shared | Emails, tokens and secrets (`ghp_`, `github_pat_`, `sk-`, `AKIA`, Slack, JWTs, private keys, `key=value` secrets, long hex/base64), URLs and git remotes, session ids, home paths (to `~`), and private terms |
| **Left out** | `cracked/` and cracked skills, `scripts/` (`--include-scripts` adds them, redacted), binary files, `--skip id1,id2`, ids containing a private term, and the rest of the basket (`logs/`, `README.md`, `PREFERENCES.md`) |

Private terms are the repo names your eggs were laid in, your home folder's name,
`--private t1,t2`, and one per line in `private-terms.txt` in your basket. Pattern
matching can't spot people, clients or internal hosts written in prose, so **read the
preview** and add those as private terms or `--skip` the item. `--repo owner/name` and
`--dir path` send it somewhere else.

## Changing the meta-skill or the egg model

Changes to `skills/deveggs/SKILL.md` or the egg model (tiers, trial rules, the hatch
threshold, the item format) change how every agent behaves for every developer. Open an
issue or PR that starts from the developer eggsperience problem: what happened in a
real session, what the agent did, and what you wanted instead. Then describe the change
and how it fixes that. A transcript excerpt (with anything private removed) helps.

## Pull requests

- **One change per PR.** Branch off an up-to-date `main`; don't push to `main`.
- **CI must pass.** `.github/workflows/ci.yml` runs on every PR:
  - `check`: `npm ci` and `npm run check` on Node 22.
  - `upstream-basket-empty`: fails if anything is committed under `my-basket/`.
- **Review.** Every change needs review from the maintainer (`.github/CODEOWNERS`).
  PRs are squash-merged.
- **Commit messages** follow `git log`: a short, plain summary of what changed for
  the user, optionally prefixed by the area (`docs:`, `Skill:`, `deveggs lay --id:`),
  then a body that says what changed and why. For example:

  ```text
  deveggs lay --id: short names instead of the first 8 words

  Ids were the first 8 words of the fact, so eggs got names like
  everything-related-to-deveggs-the-deveggs-repo-the. lay now takes --id, and the
  skill tells agents to pass a 2-4 word name. Without it, the old slug is the fallback.
  ```

By contributing, you agree your work is released under the [MIT License](LICENSE).
