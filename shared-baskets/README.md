# Shared baskets have moved

Shared baskets live in their own repo,
[kunggaochicken/deveggs-baskets](https://github.com/kunggaochicken/deveggs-baskets), under
`baskets/<github-username>/`, so this tool repo stays small. Nothing else goes in this
folder: CI rejects anything here but this README.

## Share yours

```bash
deveggs share --dry-run   # preview what's shared and what's redacted; nothing leaves your machine
deveggs share             # open a PR adding baskets/<you>/ to kunggaochicken/deveggs-baskets
```

## Borrow from others

```bash
deveggs browse                          # list shared baskets
deveggs browse <username> [--tag t]     # one basket's eggs and chickens
deveggs import <username>/<id>          # borrow one into your basket
```

`import` always adds the item as an egg on trial (✓0 ✗0), even if it was someone else's
chicken, notes where it came from, copies its skill if it has one, and refuses an id
already in your basket or one you cracked.
