import { z } from "zod";

const text = z.string().min(1).max(4096);
const empty = z.strictObject({});
export const uiSchemas = {
  "ui.context": empty,
  "ui.tabs.list": z.strictObject({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.number().int().min(0).optional(),
  }),
  "ui.file.open": z.strictObject({
    path: text,
    line: z.number().int().min(1).optional(),
  }),
  "ui.web.open": z.strictObject({ url: z.url().max(4096) }),
  "ui.tab.open": z.strictObject({
    kind: z.enum(["explorer", "source-control"]),
  }),
  "ui.tab.focus": z.strictObject({
    tabId: text,
    partition: z.enum(["shared", "workspace"]),
  }),
  "ui.terminal.open": empty,
  "ui.terminal.new": z.strictObject({
    name: z.string().trim().min(1).max(80).optional(),
  }),
  "ui.terminal.list": z.strictObject({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.number().int().min(0).optional(),
  }),
  "ui.terminal.focus": z.strictObject({
    terminalId: z.string().min(1).max(128),
  }),
  "ui.terminal.read": z.strictObject({
    terminalId: z.string().min(1).max(128),
    maxBytes: z.number().int().min(1).max(8192).optional(),
  }),
  "ui.terminal.execute": z.strictObject({
    terminalId: z.string().min(1).max(128),
    command: z.string().min(1).max(8192),
  }),
  "ui.terminal.input": z.strictObject({
    terminalId: z.string().min(1).max(128),
    data: z.string().min(1).max(8192),
  }),
  "ui.terminal.interrupt": z.strictObject({
    terminalId: z.string().min(1).max(128),
  }),
} as const;
export type UiCommandId = keyof typeof uiSchemas;
const commonUiCommands = [
  {
    id: "ui.context",
    cli: ["context"],
    description: "Inspect the main window and presented workspace.",
    topic: "targets",
    keywords: ["state", "状态", "session", "窗口"],
    capability: "ui.read",
  },
  {
    id: "ui.tabs.list",
    cli: ["tabs", "list"],
    description:
      "List tabs belonging to a workspace. Preserve the tab ID and partition when focusing.",
    topic: "tabs",
    keywords: ["tabs", "标签页", "list"],
    capability: "ui.read",
  },
  {
    id: "ui.file.open",
    cli: ["file", "open"],
    positional: "path",
    description:
      "Open an exact file path in MyStation. Relative paths use the target repository; line numbers start at 1.",
    topic: "files",
    keywords: ["file", "文件", "line", "行号"],
    capability: "ui.present",
  },
  {
    id: "ui.web.open",
    cli: ["web", "open"],
    positional: "url",
    description:
      "Open or reuse an HTTP(S) page in MyStation Browser. A tab receipt does not mean the page has loaded.",
    topic: "browser",
    keywords: ["page", "网页", "url", "browser"],
    capability: "ui.present",
  },
  {
    id: "ui.tab.open",
    cli: ["tab", "open"],
    positional: "kind",
    description:
      "Open or activate Explorer or Source Control without toggling the layout.",
    topic: "tabs",
    keywords: ["explorer", "source control", "文件树", "git"],
    capability: "ui.present",
  },
  {
    id: "ui.tab.focus",
    cli: ["tab", "focus"],
    positional: "tabId",
    description: "Reveal an existing tab by its returned ID and partition.",
    topic: "tabs",
    keywords: ["focus", "切换", "tab"],
    capability: "ui.present",
  },
] as const;
const terminalCommands = [
  {
    id: "ui.terminal.open",
    cli: ["terminal", "open"],
    capability: "ui.present",
    description:
      "Open or reuse the workspace's MyStation shell terminal. Does not send input.",
  },
  {
    id: "ui.terminal.new",
    cli: ["terminal", "new"],
    capability: "ui.present",
    description:
      "Create a shell terminal using the configured profile and target repository. Requires the presented workspace; optional --name.",
  },
  {
    id: "ui.terminal.list",
    cli: ["terminal", "list"],
    capability: "ui.read",
    description:
      "List shared MyStation shell terminal IDs and the target workspace's selected terminal. Does not claim PTY readiness.",
  },
  {
    id: "ui.terminal.focus",
    cli: ["terminal", "focus"],
    positional: "terminalId",
    capability: "ui.present",
    description:
      "Select and reveal a listed shell terminal in the target workspace.",
  },
  {
    id: "ui.terminal.read",
    cli: ["terminal", "read"],
    positional: "terminalId",
    // Scrollback carries tokens, credentials on command lines and private
    // remotes. It is a read, but not the same tier as listing tab titles:
    // it is gated on the app's UI-control permission like every other
    // terminal capability.
    capability: "terminal.read",
    description:
      "Read a bounded tail of retained redacted PTY output. --maxBytes defaults to 4096 and is capped at 8192; not a rendered screen or full history.",
  },
  {
    id: "ui.terminal.execute",
    cli: ["terminal", "execute"],
    positional: "terminalId",
    capability: "terminal.write",
    description:
      "Send --command plus one Enter to an explicitly selected live shell terminal. A receipt confirms input delivery, not command completion or success.",
  },
  {
    id: "ui.terminal.input",
    cli: ["terminal", "input"],
    positional: "terminalId",
    capability: "terminal.write",
    description:
      "Send --data literally to a live shell terminal, without adding Enter. Use a params-file for multiline text or control characters.",
  },
  {
    id: "ui.terminal.interrupt",
    cli: ["terminal", "interrupt"],
    positional: "terminalId",
    capability: "terminal.write",
    description:
      "Send Ctrl+C to an explicit live shell terminal. Does not prove that its process exited.",
  },
] as const;
/// Terminal id classes this surface never exposes. `eligible()` in
/// services/uiCommands/terminals.ts is the enforcing gate; these literals are
/// the id-shaped part of it, published so the Rust boundary stops keeping its
/// own copy. catalog.ts is imported by bare node from scripts/ui, so it cannot
/// use @src aliases — publicUi/terminalPrefixes.test.ts pins these against the
/// owning modules instead.
export const EXCLUDED_TERMINAL_ID_PREFIXES = [
  "agent-pty-",
  "chatpanel-",
] as const;
export const uiCommands = [
  ...commonUiCommands,
  ...terminalCommands.map((command) => ({
    ...command,
    topic: "terminals",
    keywords: ["terminal", "shell", "终端", "命令", "输入", "输出", "中断"],
  })),
] as const;
export const uiCatalog = {
  protocolVersion: 1,
  // Published so the Rust boundary stops re-deriving terminal ownership from
  // literals of its own. `eligible()` in services/uiCommands/terminals.ts is
  // the enforcing gate; these are the id-shaped classes it excludes, carried
  // across the wire under the same hash check as the command schemas.
  terminals: { excludedIdPrefixes: EXCLUDED_TERMINAL_ID_PREFIXES },
  commands: uiCommands.map((command) => {
    const { $schema: _schema, ...params } = z.toJSONSchema(
      uiSchemas[command.id]
    );
    const discoveryTier = [
      "ui.context",
      "ui.tabs.list",
      "ui.file.open",
      "ui.web.open",
      "ui.tab.open",
      "ui.terminal.open",
      "ui.terminal.list",
      "ui.terminal.read",
    ].includes(command.id)
      ? "common"
      : "reference";
    return { ...command, discoveryTier, params };
  }),
};
