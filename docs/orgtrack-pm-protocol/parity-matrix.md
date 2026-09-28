# Entry-Point Consistency Matrix (Layer 9 / Design Document §22.3)

Every entry point must use the same Context resolver and application command layer. A blank cell means “not implemented”; mark implemented phases with a ✓ and the phase in parentheses. Any long-term blank requires a written rationale.

| entry point       | context resolver | actor resolution | auth/capability intersection | idempotency                           | OCC (expected-revision) | audit event                                          | outbox | pm_change_seq bump |
| ----------------- | ---------------- | ---------- | -------------------- | ------------------------------------- | ----------------------- | ---------------------------------------------------- | ------ | ------------------ |
| CLI (`org2-pm`)   | (P3) ✓           | (P3) ✓     | (P3) ✓               | (P3) ✓ create/claim/transition/invoke | (P3) ✓ claim/transition | (P3) ✓                                               | (P3)   | (P3) ✓             |
| Tauri commands    | (P2a)            | (P2a)      | (P2a)                | (P2a)                                 | (P2a)                   | (P2a) ✓ create/patch/transition/delete/restore/write | (P2a)  | (P2a) ✓            |
| Routine scheduler | (P5)             | (P5)       | (P5)                 | (P5) ✓ plan-time invoke key           | (P5)                    | (P5) ✓ invoke/suppressed_fire                        | (P5)   | (P5) ✓             |
| Provider adapter  | (P6)             | (P6)       | (P6)                 | (P6)                                  | (P6)                    | (P6)                                                 | (P6)   | (P6)               |
| hooks             | (P5)             | (P5)       | (P5)                 | (P5)                                  | (P5)                    | (P5)                                                 | (P5)   | (P5)               |
| tests/E2E helpers | (P3) ✓           | (P3) ✓     | (P3) ✓               | (P3) ✓                                | (P3) ✓                  | (P3) ✓                                               | (P3)   | (P3) ✓             |

Rules:

- Tests and helpers must not use a different initialization path or a debug-only mutation path (helpers may only seed or inspect; they must not become a side-effect path for the behavior under test).
- Manual and automatic scheduler fires must call the same `routine.invoke`.
- Provider adapters must not bypass the application service to write WorkItems or relations directly.
