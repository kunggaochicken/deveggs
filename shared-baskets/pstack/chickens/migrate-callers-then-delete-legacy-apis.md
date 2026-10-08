---
id: migrate-callers-then-delete-legacy-apis
kind: preference
tags: pstack,refactoring
harnesses: 
good: 0
bad: 0
laid: 2026-10-07
updated: 2026-10-07
---
When replacing an internal API, migrate every caller and delete the old API in the same wave; no compatibility layers

Source: [pstack · principle-migrate-callers-then-delete-legacy-apis](https://github.com/cursor/plugins/blob/main/pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md)

## Origin

> Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers.

- 2026-10-07 · cursor/plugins (pstack)
