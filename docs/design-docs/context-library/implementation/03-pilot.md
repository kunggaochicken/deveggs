# Phase 3: compatibility, privacy and opt-in pilot

| State | Entry | Owner/write boundary |
|---|---|---|
| not_started | Phase 2 full slice verified | Migration owner: legacy adapter/tests; privacy owner: share tests; coordinator: docs/pilot/status |

## Work and integration

| Order | Work ID | Deliverable | Verification |
|---|---|---|---|
| Parallel A | CL-9 | Read-only legacy-history adapter with stable source identities | Historical harness known, model unknown; repeated imports dedupe; existing counts identical |
| Parallel B | CL-10 | Explicit export exclusion for experiences, registry, sessions and views | Sharing dry-run against synthetic secrets and private incident fixtures |
| Join | CL-11 | Opt-in pilot guide, README/meta-skill/INSTALL consistency | Capture one incident, preview attention, switch runtime and inspect lineage |
| Verify | CL-12 | Architecture review, full checks, PR and release evidence | `npm run check`; CI/review status; exact shipped revision |

## Exit and recovery

| Exit criterion | Evidence packet | Recovery |
|---|---|---|
| Existing workflows retain behavior; scoped proof is not fabricated | Legacy fixtures, counter comparison and original source references | Disable legacy projection; retain original histories |
| Developer can stop contextual loading and keep the library | Pilot rollback steps demonstrated in throwaway environment | Baseline-only sessions; preserve source records |
| Package is fully shipped | PR/merge evidence and behavior verification | Archive package under completed and repair links only after shipping |

Raw private experiences are never published by the pilot. Any future sharing/import of contextual lessons is a separate design with explicit provenance and privacy requirements.
