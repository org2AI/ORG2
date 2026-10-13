# Low-level UI protocol compatibility

Prefer the concrete tools in `docs native` for new agent calls. The envelopes below remain available for existing integrations.

Use the built-in control_orgii tool without starting a shell or another harness.

Discover the running instance and command catalog:

```json
{ "action": "ui.capabilities" }
```

Read common instructions or one topic:

```json
{"action":"ui.rulebook"}
{"action":"ui.docs","params":{"topic":"files"}}
{"action":"ui.docs","params":{"query":"文件"}}
```

Send the same versioned request the CLI sends, for **read commands only**
(the `ui.read` and `terminal.read` capabilities: `ui.context`,
`ui.tabs.list`, `ui.terminal.list`, `ui.terminal.read`). Replace the example instance and session with discovered
IDs; use a fresh request ID. A request's target session is the workspace
destination, not the caller's identity.

Commands that present UI or write to a terminal are rejected here and must go
through `open_in_org2` and `write_org2_terminal`. Tool policy is resolved by
tool name, so a mutating command inside this envelope would be invisible to it:
`control_orgii` is not on the read-only deny list, and forwarding one would
reach `ui.terminal.execute` from Plan or Review mode, where both `run_shell`
and `write_org2_terminal` are denied.

```json
{
  "uiRequest": {
    "protocolVersion": 1,
    "requestId": "unique-request-id",
    "command": "ui.terminal.list",
    "target": {
      "instanceId": "discovered-instance-id",
      "windowId": "main",
      "workspace": {
        "kind": "session",
        "sessionId": "discovered-local-session-id"
      }
    },
    "params": { "limit": 20 },
    "reveal": false,
    "timeoutMs": 10000
  }
}
```

To inspect the current presentation, send a request with command `ui.context`, params `{}`, and workspace `{"kind":"global"}`. The result contains the presented workspace. Use that result only when it matches the user's intended target. Read `ui.docs` with topic `results` before retrying an unknown result. Native callers can query a retained receipt using action `ui.receipt` with params.requestId; receipt ownership is bound to the invoking harness session.
