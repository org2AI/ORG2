# Agent tools through the CLI

The standalone `org2-ui` and desktop `org2 ui` entry points share the same tool catalog as the native adapter. These metadata and documentation commands work without a running app:

```sh
org2 ui tools
org2 ui tools open_in_org2
org2 ui docs native
org2 ui docs --search terminal
```

Put tool arguments in a JSON file to preserve literal strings and avoid shell interpolation:

```json
{ "target": { "type": "file", "path": "src/main.ts", "line": 42 } }
```

```sh
org2 ui call open_in_org2 --params-file open.json --target-file target.json
```

A host can provide `ORG2_UI_TARGET_FILE` in the child process environment so each call defaults to its calling workspace. The file contains the complete target, not authentication material:

```json
{
  "instanceId": "discovered-instance-uuid",
  "windowId": "main",
  "workspace": { "kind": "session", "sessionId": "calling-session-id" }
}
```

The harness must create and bind that file itself. Use an immutable file per invocation/session; do not share a mutable file between concurrent sessions. ORG2 does not infer an external harness's calling session. Without this binding, pass a target file or explicit instance/window/workspace options. Discovery uses authenticated loopback endpoints under the selected `ORGII_HOME`.

Any explicit `--target-file`, `--instance`, `--window`, `--session` or `--global` replaces the environment binding as a whole. Partial overrides do not inherit its workspace. An explicit instance must agree with a target file. Inside tool arguments, `workspace` can change the destination within the bound instance; it does not change caller identity or receipt ownership.

```sh
org2 ui call list_org2_terminals
org2 ui call write_org2_terminal --params-file input.json
org2 ui call get_org2_ui_result --params-file receipt.json
```

The last two files contain `{"terminalId":"returned-id","input":{"type":"execute","command":"pwd"}}` and `{"requestId":"returned-request-id"}` respectively. Read the terminal before writing; never automatically replay uncertain input. Use `--request-id` to retain a host-owned identity across transport reconciliation, not to replay a different operation.

The `call` facade defaults opens to presentation, just like the native tool. Raw commands such as `file open` retain their existing opt-in `--reveal` behavior. For `call`, put `reveal` in the JSON arguments. Command-specific flags are rejected; obtain the exact input schema with `tools <name>`. Low-level `exec`, `schema` and `request status` remain available.

Receipts from CLI requests retain the existing CLI caller namespace; native session receipts remain separate. The catalog describes callable tools, but is not an MCP server or an automatically installed Skill. An external harness needs this CLI binding or its own adapter.
