---
id: fix-root-causes
kind: preference
tags: pstack,debugging
harnesses: 
good: 0
bad: 0
laid: 2026-10-07
updated: 2026-10-07
---
When debugging, reproduce first and fix the root cause; never silence a crash with a nil-check guard

Source: [pstack · principle-fix-root-causes](https://github.com/cursor/plugins/blob/main/pstack/skills/principle-fix-root-causes/SKILL.md)

## Origin

> Apply when debugging. Trace each symptom to its root cause and fix it there; reproduce first, ask why until you reach it, resist nil-check guards that silence crashes.

- 2026-10-07 · cursor/plugins (pstack)
