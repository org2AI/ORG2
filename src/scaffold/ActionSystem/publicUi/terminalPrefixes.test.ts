import { describe, expect, it } from "vitest";

import { CHAT_PANEL_TERMINAL_PREFIX } from "@src/util/ui/terminal/chatPanelSessionId";
import { AGENT_PTY_SESSION_PREFIX } from "@src/util/ui/terminal/ptySessionId";

import catalog from "../../../../src-tauri/crates/app-ui/catalog.json";
import { EXCLUDED_TERMINAL_ID_PREFIXES } from "./catalog";

// catalog.ts is imported by bare node from scripts/ui/generate-catalog.mjs, so
// it cannot use @src aliases and has to restate these literals. This test is
// what keeps the restatement honest: the published list, the constant and the
// owning modules must all agree, and src-tauri/src/api/ui_commands reads the
// published list rather than keeping a third copy.
describe("published terminal id prefixes", () => {
  it("matches the modules that own each prefix", () => {
    expect([...EXCLUDED_TERMINAL_ID_PREFIXES]).toEqual([
      AGENT_PTY_SESSION_PREFIX,
      CHAT_PANEL_TERMINAL_PREFIX,
    ]);
  });

  it("is what the generated catalog publishes to Rust", () => {
    expect(catalog.terminals.excludedIdPrefixes).toEqual([
      ...EXCLUDED_TERMINAL_ID_PREFIXES,
    ]);
  });
});
