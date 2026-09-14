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

Execute the same versioned request that the CLI sends. Replace the example instance and session with discovered IDs; use a fresh request ID. A request's target session is the workspace destination, not the caller's identity.

```json
{
  "uiRequest": {
    "protocolVersion": 1,
    "requestId": "unique-request-id",
    "command": "ui.file.open",
    "target": {
      "instanceId": "discovered-instance-id",
      "windowId": "main",
      "workspace": {
        "kind": "session",
        "sessionId": "discovered-local-session-id"
      }
    },
    "params": { "path": "src/main.ts", "line": 42 },
    "reveal": true,
    "timeoutMs": 10000
  }
}
```

To inspect the current presentation, send a request with command `ui.context`, params `{}`, and workspace `{"kind":"global"}`. The result contains the presented workspace. Use that result only when it matches the user's intended target. Read `ui.docs` with topic `results` before retrying an unknown result. Native callers can query a retained receipt using action `ui.receipt` with params.requestId; receipt ownership is bound to the invoking harness session.
