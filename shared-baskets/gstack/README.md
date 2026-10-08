# gstack

All of [gstack](https://github.com/garrytan/gstack) by Garry Tan (MIT, see
[`LICENSE`](LICENSE)), vendored from `garrytan/gstack@f67c478` as a deveggs basket.
Nothing here links out to work: the full source is in [`gstack/`](gstack/).

| Path | What's there |
| --- | --- |
| `gstack/` | The gstack repo, verbatim, minus its `test/` suite and git history |
| `chickens/<id>.md` | One 🐔 per skill (57, including the `gstack` router), plus the 3 [ETHOS](gstack/ETHOS.md) principles |
| `skills/chickens/<id>` | Symlinks into `gstack/<id>`, so each skill is tracked like any deveggs skill |

gstack's skills expect the whole repo at `~/.claude/skills/gstack/`. They call its
`bin/` scripts, docs and each other there over 1,000 times. So the source stays
whole and unedited, and setup links it into place instead of rewriting paths.

## Borrowing it

1. Copy `chickens/` into your basket's `eggs/` (see [`../README.md`](../README.md#borrowing-an-egg)),
   and copy `gstack/` to your basket's root.
2. Link it where its skills look for it, then run gstack's own setup. It builds the
   `browse` binary with [bun](https://bun.sh) and registers the skills with every agent it finds:

   ```bash
   ln -s ~/.deveggs/gstack ~/.claude/skills/gstack
   ~/.claude/skills/gstack/setup --host auto
   ```

   gstack's setup links the skills itself, so don't link them a second time.

`user-sovereignty` conflicts with pstack's `principle-never-block-on-the-human`.
Borrow one, not both.
