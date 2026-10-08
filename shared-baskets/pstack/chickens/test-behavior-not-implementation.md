---
id: test-behavior-not-implementation
kind: preference
tags: pstack,testing
harnesses: 
good: 0
bad: 0
laid: 2026-10-07
updated: 2026-10-07
---
Test code the way its users call it and assert observable results against literal expected values

Source: [pstack · principle-test-behavior-not-implementation](https://github.com/cursor/plugins/blob/main/pstack/skills/principle-test-behavior-not-implementation/SKILL.md)

## Origin

> Apply when you write, change, or keep a test. Call the code the way its users do and assert the result they observe against a literal expected value. If the test would still pass when every imported function returns undefined, rewrite the assertion or delete the test.

- 2026-10-07 · cursor/plugins (pstack)
