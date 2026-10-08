---
id: principle-separate-before-serializing-shared-state
kind: skill
tags: pstack,principle
harnesses: 
good: 0
bad: 0
laid: 2026-10-07
updated: 2026-10-07
---
Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant.

The full skill is in [`skills/chickens/principle-separate-before-serializing-shared-state/`](../skills/chickens/principle-separate-before-serializing-shared-state/SKILL.md).

## Origin

> Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant.

- 2026-10-07 · cursor/plugins@ccb5507 · [pstack/skills/principle-separate-before-serializing-shared-state](https://github.com/cursor/plugins/tree/ccb5507/pstack/skills/principle-separate-before-serializing-shared-state)
