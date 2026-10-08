# Shared baskets

Community baskets: developers who chose to publish how they work with agents.
Browse them for ideas, and borrow anything that looks useful.

## Baskets

| Basket | What's in it |
| --- | --- |
| [`gstack/`](gstack/) | All of Garry Tan's [gstack](https://github.com/garrytan/gstack), vendored: 57 skills, their scripts and the browse tool, plus its 3 ETHOS principles |
| [`pstack/`](pstack/) | All of Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/main/pstack), vendored: 54 skills (24 principles), playbooks, scripts and guide |

These two are full copies of published stacks, named after the stack, not a GitHub user.
They're self-contained: borrowing one reproduces the stack without fetching it. Each
item's Origin records the upstream commit it came from.

## Borrowing an egg

Copy the file into your own basket's `eggs/` folder, **never** into `chickens/`.
Someone else's chicken is only an egg for you: it hasn't been tried in your loop.
Clear the `trials` row (`✓0 ✗0`) and the `## Trials` log. Then add a line to its
`context` saying where you borrowed it from, and try it like any other egg.

Borrowed skills work the same way: copy `skills/chickens/<id>/` into your
`~/.deveggs/skills/eggs/<id>/` and add `[egg: on trial] ` to the start of its description.

## Sharing yours

1. **Review before you share.** An egg's Origin section and `context` row hold your
   verbatim words, repo names and session details. Remove anything private:
   client names, internal repos, credentials, anything from work you can't publish.
   Consider leaving out `cracked/`.
2. Copy your basket into `shared-baskets/<your-github-username>/`, keeping the same layout
   (`eggs/`, `chickens/`, `skills/`, …). Optionally add a `README.md` about how you work.
3. Open a PR to `kunggaochicken/deveggs` from a branch based on its `main`. It should touch only `shared-baskets/<your-github-username>/`.

Your personal basket (`~/.deveggs/`) itself must never be committed here, because
everyone would pull your eggs into their own basket.
