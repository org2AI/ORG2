# Native agent tools

ORG2's ADE Manager exposes eight concrete tools when app management is available. These examples show the tool name and its arguments; pass only `arguments` to the named tool.

```json
{"tool":"open_in_org2","arguments":{"target":{"type":"file","path":"src/main.ts","line":42}}}
{"tool":"open_in_org2","arguments":{"target":{"type":"browser","url":"https://example.com"}}}
{"tool":"open_in_org2","arguments":{"target":{"type":"source-control"}}}
{"tool":"open_in_org2","arguments":{"target":{"type":"terminal"}}}
{"tool":"list_org2_terminals","arguments":{}}
{"tool":"read_org2_terminal","arguments":{"terminalId":"returned-id","maxBytes":4096}}
{"tool":"write_org2_terminal","arguments":{"terminalId":"returned-id","input":{"type":"execute","command":"pwd"}}}
{"tool":"write_org2_terminal","arguments":{"terminalId":"returned-id","input":{"type":"input","data":"literal text"}}}
{"tool":"write_org2_terminal","arguments":{"terminalId":"returned-id","input":{"type":"interrupt"}}}
```

`open_in_org2` also supports `explorer`, `new-terminal` with an optional name, and `tab` with a returned `tabId` and `partition`. A terminal target with a `terminalId` focuses that exact terminal; omitting it reuses the selected shell terminal or opens one. Use `new-terminal` only when a separate terminal is intended. Agent-owned and chat-panel terminals are excluded.

The native adapter binds the current app instance, main window and calling session, independently of the visible session. The host supplies a stable request identity for the tool call. Execution tools accept an optional `workspace`, for example `{"kind":"global"}` or `{"kind":"session","sessionId":"discovered-id"}`. An absent calling session fails closed unless an explicit workspace is supplied. Tools do not accept model-provided instance IDs, protocol versions or request IDs. Responses/Codex strict schemas encode omitted optional fields as `null`; `workspace: null` uses the calling workspace and `reveal: null` keeps the default presentation behavior.

Open requests presentation by default. Set `reveal: false` for background registration; existing tab/terminal focus rejects this option because it necessarily requests presentation. Browser creation and new terminals require the presented workspace. Use `get_org2_context` and `list_org2_tabs` for state and discovery. Opening a file does not read it, and opening a browser does not grant browser interaction.

Use `get_org2_ui_docs` with one of `topic`, `query` or `command` for references. Omit all fields for the index. Use `get_org2_ui_result` with a returned `requestId` to inspect a retained receipt in the same native calling-session namespace. An unavailable receipt does not prove an action did not happen. Terminal execution is input delivery, not a process runner with an exit code.

The low-level `control_orgii` UI actions remain compatible for existing callers; see the `protocol` topic. Other harnesses can use the same tool catalog and argument mapping through the CLI; see `cli`. This release does not install an MCP server or a harness plugin.
