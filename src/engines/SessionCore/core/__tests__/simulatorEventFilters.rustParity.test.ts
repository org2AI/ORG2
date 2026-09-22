/**
 * Rust parity table for `getFallbackSimulatorEventFilterCategory`.
 *
 * `rust` mirrors what `classify_simulator_event` in
 * `src-tauri/crates/types/src/session_event.rs` returns for the same event.
 * `ts` is what the frontend fallback returns today. Rows where they differ are
 * the known divergences documented in `core/simulatorEventFilters.ts`; the
 * fallback only seeds local previews until the Rust snapshot overwrites them,
 * so aligning the two is a behavior change, not a refactor. When you change
 * either classifier, update the row and — if a divergence closes or opens —
 * `KNOWN_DIVERGENCES`, so drift is visible in review instead of silent.
 */
import { describe, expect, it } from "vitest";

import { getFallbackSimulatorEventFilterCategory } from "../simulatorEventFilters";
import type { SessionEvent, SimulatorEventFilterValue } from "../types";

function event(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    chunk_id: "event-1",
    id: "event-1",
    sessionId: "session-1",
    createdAt: "2026-06-22T00:00:00.000Z",
    functionName: "noop",
    uiCanonical: "noop",
    actionType: "tool_call",
    args: {},
    result: {},
    source: "assistant",
    displayText: "Noop",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "processed",
    ...overrides,
  };
}

interface ParityRow {
  name: string;
  event: Partial<SessionEvent>;
  ts: SimulatorEventFilterValue;
  rust: SimulatorEventFilterValue;
}

const PARITY_TABLE: readonly ParityRow[] = [
  // --- Agreeing rows --------------------------------------------------------
  {
    name: "user message",
    event: { source: "user", uiCanonical: "user_message" },
    ts: "key_interactions",
    rust: "key_interactions",
  },
  {
    name: "user message with a file path still wins as key interaction",
    event: { source: "user", uiCanonical: "user_message", filePath: "a.ts" },
    ts: "key_interactions",
    rust: "key_interactions",
  },
  {
    name: "edit_file",
    event: { uiCanonical: "edit_file", filePath: "src/App.tsx" },
    ts: "file_changes",
    rust: "file_changes",
  },
  {
    name: "delete_file",
    event: { uiCanonical: "delete_file", filePath: "src/App.tsx" },
    ts: "file_changes",
    rust: "file_changes",
  },
  {
    name: "edit_file with a command still classifies as file change",
    event: { uiCanonical: "edit_file", command: "sed -i" },
    ts: "file_changes",
    rust: "file_changes",
  },
  {
    name: "run_shell",
    event: { uiCanonical: "run_shell", command: "pnpm test" },
    ts: "terminal_events",
    rust: "terminal_events",
  },
  {
    name: "unknown tool carrying a command",
    event: { uiCanonical: "unknown_tool", command: "pnpm test" },
    ts: "terminal_events",
    rust: "terminal_events",
  },
  {
    name: "read_file with a path is explore, not file change",
    event: { uiCanonical: "read_file", filePath: "src/App.tsx" },
    ts: "explore",
    rust: "explore",
  },
  {
    name: "list_dir",
    event: { uiCanonical: "list_dir" },
    ts: "explore",
    rust: "explore",
  },
  {
    name: "code_search",
    event: { uiCanonical: "code_search" },
    ts: "explore",
    rust: "explore",
  },
  {
    name: "find_files",
    event: { uiCanonical: "find_files" },
    ts: "explore",
    rust: "explore",
  },
  {
    name: "unknown tool with a file path",
    event: { uiCanonical: "unknown_tool", filePath: "src/App.tsx" },
    ts: "file_changes",
    rust: "file_changes",
  },
  {
    name: "unknown tool with nothing else",
    event: { uiCanonical: "unknown_tool" },
    ts: "other",
    rust: "other",
  },
  {
    name: "thinking",
    event: { uiCanonical: "thinking", displayVariant: "thinking" },
    ts: "other",
    rust: "other",
  },
  // --- Known divergences ----------------------------------------------------
  // Rust falls back to function_name when ui_canonical is empty; TS reads
  // uiCanonical only, so an un-normalized event loses its routing.
  {
    name: "empty uiCanonical falls back to functionName in Rust only",
    event: { uiCanonical: "", functionName: "edit_file" },
    ts: "other",
    rust: "file_changes",
  },
  // Rust routes interactive widgets to key_interactions; TS only routes
  // source === "user" there.
  {
    name: "ask_user_questions",
    event: { uiCanonical: "ask_user_questions" },
    ts: "other",
    rust: "key_interactions",
  },
  {
    name: "ask_user_permissions",
    event: { uiCanonical: "ask_user_permissions" },
    ts: "other",
    rust: "key_interactions",
  },
  {
    name: "suggest_mode_switch",
    event: { uiCanonical: "suggest_mode_switch" },
    ts: "other",
    rust: "key_interactions",
  },
  {
    name: "create_plan",
    event: { uiCanonical: "create_plan" },
    ts: "other",
    rust: "key_interactions",
  },
  {
    name: "manage_secrets",
    event: { uiCanonical: "manage_secrets" },
    ts: "other",
    rust: "key_interactions",
  },
  // Rust routes the shell follow-up tools to terminal_events; TS only
  // recognizes run_shell (or a populated `command`).
  {
    name: "await_output without a command",
    event: { uiCanonical: "await_output" },
    ts: "other",
    rust: "terminal_events",
  },
  {
    name: "inspect_terminals",
    event: { uiCanonical: "inspect_terminals" },
    ts: "other",
    rust: "terminal_events",
  },
  // Rust's explore set carries CLI-normalized and web/LSP names that TS does
  // not list; they fall through to TS's filePath / other branches.
  {
    name: "list_directory (CLI-normalized list_dir)",
    event: { uiCanonical: "list_directory" },
    ts: "other",
    rust: "explore",
  },
  {
    name: "codebase_search (CLI-normalized code_search)",
    event: { uiCanonical: "codebase_search" },
    ts: "other",
    rust: "explore",
  },
  {
    name: "glob_file_search",
    event: { uiCanonical: "glob_file_search" },
    ts: "other",
    rust: "explore",
  },
  {
    name: "web_search",
    event: { uiCanonical: "web_search" },
    ts: "other",
    rust: "explore",
  },
  {
    name: "web_fetch",
    event: { uiCanonical: "web_fetch" },
    ts: "other",
    rust: "explore",
  },
  {
    name: "query_lsp with a file path",
    event: { uiCanonical: "query_lsp", filePath: "src/App.tsx" },
    ts: "file_changes",
    rust: "explore",
  },
  {
    name: "tool_search",
    event: { uiCanonical: "tool_search" },
    ts: "other",
    rust: "explore",
  },
  // TS lists `glob` and `search`, which are not Rust ui_canonical names; Rust
  // sends them through its file_path / other fallthrough.
  {
    name: "glob (TS-only explore name)",
    event: { uiCanonical: "glob" },
    ts: "explore",
    rust: "other",
  },
  {
    name: "search (TS-only explore name)",
    event: { uiCanonical: "search", filePath: "src" },
    ts: "explore",
    rust: "file_changes",
  },
  // Rust treats Some("") as present; TS treats "" as absent.
  {
    name: "empty-string command",
    event: { uiCanonical: "unknown_tool", command: "" },
    ts: "other",
    rust: "terminal_events",
  },
  {
    name: "empty-string filePath",
    event: { uiCanonical: "unknown_tool", filePath: "" },
    ts: "other",
    rust: "file_changes",
  },
];

const KNOWN_DIVERGENCES = [
  "empty uiCanonical falls back to functionName in Rust only",
  "ask_user_questions",
  "ask_user_permissions",
  "suggest_mode_switch",
  "create_plan",
  "manage_secrets",
  "await_output without a command",
  "inspect_terminals",
  "list_directory (CLI-normalized list_dir)",
  "codebase_search (CLI-normalized code_search)",
  "glob_file_search",
  "web_search",
  "web_fetch",
  "query_lsp with a file path",
  "tool_search",
  "glob (TS-only explore name)",
  "search (TS-only explore name)",
  "empty-string command",
  "empty-string filePath",
];

describe("getFallbackSimulatorEventFilterCategory Rust parity table", () => {
  it.each(PARITY_TABLE.map((row) => [row.name, row] as const))(
    "%s",
    (_name, row) => {
      expect(getFallbackSimulatorEventFilterCategory(event(row.event))).toBe(
        row.ts
      );
    }
  );

  it("documents exactly the known divergences from the Rust classifier", () => {
    const divergent = PARITY_TABLE.filter((row) => row.ts !== row.rust).map(
      (row) => row.name
    );
    expect(divergent).toEqual(KNOWN_DIVERGENCES);
  });

  it("uses unique row names", () => {
    const names = PARITY_TABLE.map((row) => row.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
