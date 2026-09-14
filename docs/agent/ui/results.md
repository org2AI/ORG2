JSON commands return one result on stdout. `applied` confirms the reported tab/state mutation; it does not certify page loading, editor rendering, or OS window focus. Inspect `created`, `revealed`, `presentationState`, `contentState` and `locationState`. `failed` carries a structured error. A failure after partial work is not an automatic rollback.

`unknown` means a timeout or connection loss prevented confirmation. Preserve the request ID and query:

```text
org2 ui request status <request-id> --instance <instance-id> --json
```

Receipts are retained for at most 60 seconds and 256 completed requests per app instance. Pending requests are limited to 50. A repeated request with the same request ID and identical payload reuses the result while retained. To retry an identical invocation, pass `--request-id <original-id>`. Changing its command, target, parameters, timeout or reveal flag is rejected. A request ID collision across callers is also rejected.

An unavailable receipt may be pending, expired or from another instance. Inspect target state before creating a new request. After restart, there is no exactly-once guarantee. Domain open operations reuse existing resources, but do not generalize that behavior to other actions.

Exit codes: 0 applied, 2 invalid CLI/target request, 3 denied, 4 unavailable/protocol/busy, 5 unknown, 6 file/tab domain failure. UI permissions are rechecked immediately before mutation. A caller cancellation or expired request cannot authorize a later write after asynchronous file preparation.

Terminal input receipts confirm delivery only. `TERMINAL_WRITE_UNKNOWN` means the OS write may have partially completed or may finish later; do not resend automatically. `TERMINAL_NOT_READY` means no live PTY exists for the registered resource. Read `docs terminals` for command/input/interrupt semantics and output limits.
