# Usage range architecture review

| Layer                     | Assessment                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | TypeScript typecheck and scoped lint verify the isolated PR                                                                                                    |
| 2 Ownership/deduplication | Usage panel owns applied scope; picker owns two draft strings; shared Input owns field styles                                                                  |
| 3 Naming                  | UsageRange distinguishes preset strings from custom epoch bounds; TimePicker mode distinguishes numeric time props from date-time string props                 |
| 4 Semantics               | UI hour precision is separate from parser precision; equal bounds are valid and the parser includes the selected end second (999ms), not the entire end hour   |
| 5 Defaults                | Existing time-only callers retain minuteStep=5; date-time defaults to hours with optional minutes; preset defaults remain unchanged                            |
| 6 Boundaries              | Shared TimePicker does not know usage queries or translations; parser stays in usage domain                                                                    |
| 7 Readability             | Custom option shares the options array; its editor remains a controlled nested Dropdown; applied state is committed only by Apply                              |
| 8 Wire                    | Existing UsageScope startMs/endMs and session/bucket fields remain unchanged; panel test asserts API arguments; no new IPC schema or live backend verification |
| 9 Init parity             | Menu selection and applied-range reopening both use openEditor; both bounds normalize to hours                                                                 |
| 10 Resolver symmetry      | Both bounds use the same local-date parser and round-trip validation; end alone adds 999ms for existing inclusive-second semantics                             |

All ten layers reviewed. Rust compilation, migrations and schema generation are inapplicable: no backend, database, dependency or wire-format change. Stored historical data is unchanged; revert the feature commit to roll back.
