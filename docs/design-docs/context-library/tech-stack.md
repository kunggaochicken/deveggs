# Technical choices

| Status | Constraint |
|---|---|
| Proposed | Preserve strict TypeScript, Node standard library and zero runtime dependencies |

## Storage and ownership

| Choice | Reason | Limitation |
|---|---|---|
| JSON event files in the personal basket | Standard parser, schema versioning, readable diffs, one file per event avoids concurrent shared-log writes | Many files eventually need indexing |
| Existing Markdown preference/history files | Preserve human ownership and existing lifecycle | Old records lack exact runtime identity |
| Generated Markdown attention views | Fits current instruction loading | Acknowledgment is needed to know a harness consumed it |
| Git for durability | Uses existing basket behavior | Git is backup/versioning, not a concurrent transaction manager |

No database, vector store, hosted service or new runtime dependency is needed for MVP. Add an index only after measured query scale warrants one; generated indexes must remain disposable.

## Module boundaries

| Proposed module | Responsibility | Existing integration |
|---|---|---|
| `src/experiences.ts` | Validate/read/write versioned immutable events; idempotency and effective amendments | CLI and basket storage |
| `src/contexts.ts` | Runtime identity, matching, lineage provenance and segment manifests | CLI; harness-native metadata instructions |
| `src/attention.ts` | Pure classification, aggregation, conflict checks and view compilation | Canonical `Basket` read interface |
| Existing `src/basket.ts` | Canonical item model; applicability extensions are future-only | Preserve current versions and legacy counts |
| Existing `src/cli.ts` | Command orchestration and persistence | New commands are proposed in the plan |
| Existing `src/install.ts` | Global baseline loading only | Never replace global block with one session's model view |

## Runtime integration

| Boundary | Contract |
|---|---|
| Tool → personal basket | Validate first; durable source write before compilation; existing commit/autopush semantics remain explicit |
| Compiler → session | Immutable manifest plus generated overlay; context-specific output path |
| Harness → metadata | Agent-native instructions in `INSTALL.md`; capability may be unavailable and is recorded as unknown |
| Model switch → overlay | New context segment; no reuse of a stale overlay under a newly asserted identity |
| Shared export → other developers | Default deny the entire new library and derived artifacts; canonical sanitized sharing stays explicit |

A static global instruction file cannot reliably encode a session's changing model. MVP therefore keeps baseline global and uses documented session loading; automatic session-start or model-switch hooks are capability-dependent future work, never asserted to exist for all harnesses.
