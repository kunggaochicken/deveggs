---
id: guard-the-context-window
kind: preference
tags: pstack,agents
harnesses: 
good: 0
bad: 0
laid: 2026-10-07
updated: 2026-10-07
---
Route bulk output to subagents and keep summaries, not raw payloads, in the main thread

Source: [pstack · principle-guard-the-context-window](https://github.com/cursor/plugins/blob/main/pstack/skills/principle-guard-the-context-window/SKILL.md)

## Origin

> Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads.

- 2026-10-07 · cursor/plugins (pstack)
