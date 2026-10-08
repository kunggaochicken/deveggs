---
id: principle-guard-the-context-window
kind: skill
tags: pstack,principle
harnesses: 
good: 0
bad: 0
laid: 2026-10-07
updated: 2026-10-07
---
Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads.

The full skill is in [`skills/chickens/principle-guard-the-context-window/`](../skills/chickens/principle-guard-the-context-window/SKILL.md).

## Origin

> Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads.

- 2026-10-07 · cursor/plugins@ccb5507 · [pstack/skills/principle-guard-the-context-window](https://github.com/cursor/plugins/tree/ccb5507/pstack/skills/principle-guard-the-context-window)
