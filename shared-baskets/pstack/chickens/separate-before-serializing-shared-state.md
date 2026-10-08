---
id: separate-before-serializing-shared-state
kind: preference
tags: pstack,concurrency
harnesses: 
good: 0
bad: 0
laid: 2026-10-07
updated: 2026-10-07
---
When concurrent actors might write the same state, eliminate the sharing first; serialize only when one shared writer is a real invariant

Source: [pstack · principle-separate-before-serializing-shared-state](https://github.com/cursor/plugins/blob/main/pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md)

## Origin

> Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant.

- 2026-10-07 · cursor/plugins (pstack)
