# Orgtrack PM Protocol — Phase 0 Frozen Artifacts

Phase 0 deliverables for the `orgtrack/v1` WorkItem + Routine CLI protocol. This directory is the source of truth for the protocol wire contract: schemas and golden fixtures will be consumed directly by Phase 3+ conformance tests. `decisions.md` records all naming and boundary decisions frozen in Phase 0. Implementations that conflict with these decisions must follow this directory.

The design is based on “Orgtrack WorkItem + Routine CLI Protocol — Final Design,” rev 2 (revised after the 2026-08-04 audit; not yet checked in).

## Contents

```text
decisions.md          Phase 0 frozen decisions (mode/capability/provider id/hook names/
                      manifest/CLI transport/watermark/exit code)
parity-matrix.md      Entry-point consistency matrix (fill in each cell as phases land)
schemas/              JSON Schema (draft-07)
  common.schema.json            Shared $defs: ActorRef, SessionRef, status enums,
                                capability vocabulary
  envelope.schema.json          Success/error CLI envelopes and stable error codes
  execution-context.schema.json ExecutionContext returned by `org2 context`
  work-item.schema.json         Canonical WorkItem shape
  routine.schema.json           Portable Routine spec
  routine-run.schema.json       RoutineRun occurrence
fixtures/
  success/            Golden success-envelope fixtures for each command family
  errors/             One golden fixture for each of the 18 stable error codes
```

## Conventions

- Fixtures are byte-level goldens: conformance tests compare the actual serialized bytes. Do not allow hidden `$schema`, remote `$ref`, secrets, or local paths into wire payloads.
- Codes not listed in the error-code enum in `envelope.schema.json` must not appear in any implementation.
- Schema changes must be accompanied by updates to fixtures and `decisions.md`. CI treats any inconsistency among the three as a failure (once Phase 3 integration lands).

## Phase 0 Outstanding Item

- Exporting existing Routine/WorkItem data (migration fixture) requires the development machine's `projects.db`. This is deferred until Phase 4 begins; a script and export sample will be checked in then.
