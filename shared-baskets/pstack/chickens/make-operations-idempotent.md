---
id: make-operations-idempotent
kind: preference
tags: pstack,code
harnesses: 
good: 0
bad: 0
laid: 2026-10-07
updated: 2026-10-07
---
Design commands and processing loops to converge to the same end state despite crashes, restarts and retries

Source: [pstack · principle-make-operations-idempotent](https://github.com/cursor/plugins/blob/main/pstack/skills/principle-make-operations-idempotent/SKILL.md)

## Origin

> Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Converge to the same end state regardless of partial prior runs.

- 2026-10-07 · cursor/plugins (pstack)
