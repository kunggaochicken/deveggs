# pstack

All of [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan (MIT,
see [`LICENSE`](LICENSE)), vendored from `cursor/plugins@ccb5507` (pstack 0.15.15) as a
deveggs basket. Nothing here links out to work. Every skill, playbook, script and
guide page is copied in.

| Path | What's there |
| --- | --- |
| `chickens/<id>.md` | One 🐔 per skill: its description, plus where it came from |
| `skills/chickens/<id>/` | The full skill, verbatim: all 51 pstack skills (24 `principle-*`, `poteto-mode` with its playbooks and scripts, …) and Benny's 3 |
| `docs/guide/` | The pstack guide, which the skills link to |
| `agents/` | pstack's two subagent definitions |
| `automations/benny/` | Benny's README, `FOR_AGENTS.md` and templates |
| `upstream-README.md` | pstack's own README |

Only relative links changed, where a file moved: `skills/<id>` became
`skills/chickens/<id>`, and Benny's skills moved next to the rest.

## Borrowing it

Follow [`../README.md`](../README.md#borrowing-an-egg): copy `chickens/` into your
basket's `eggs/` and `skills/chickens/*` into `skills/eggs/`. Also copy `docs/`, `agents/`
and `automations/` to your basket's root, so the skills' links resolve. `poteto-mode`'s
scripts need [bun](https://bun.sh).

`principle-never-block-on-the-human` conflicts with gstack's `user-sovereignty`.
Borrow one, not both.
