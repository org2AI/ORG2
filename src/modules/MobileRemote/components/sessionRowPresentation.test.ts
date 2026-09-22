import { describe, expect, it } from "vitest";

import { resolveSessionDisplayMetadata } from "@src/util/session/sessionDisplayMetadata";

import {
  mobileSessionIconInput,
  mobileSessionRowStatus,
} from "./sessionRowPresentation";

describe("mobile row canonical presentation", () => {
  it.each([
    "waiting_for_user",
    "waiting_for_funds",
    "paused",
    "installing",
    "pending",
    "running",
    "idle",
    "completed",
    "cancelled",
    "failed",
    "archived",
  ])(
    "retains canonical %s rather than the lossy compatibility state",
    (lifecycleStatus) => {
      expect(
        mobileSessionRowStatus({
          id: "native",
          name: "Name",
          status: "running",
          lifecycleStatus,
        })
      ).toBe(lifecycleStatus);
    }
  );
  it("does not treat an unknown lifecycle as idle or working", () => {
    expect(
      mobileSessionRowStatus({
        id: "native",
        name: "Name",
        status: "running",
        lifecycleStatus: "future_phase",
      })
    ).toBe("unknown");
    expect(
      mobileSessionRowStatus({
        id: "old-desktop",
        name: "Name",
        status: "running",
      })
    ).toBe("running");
  });
  it.each([
    [
      "sdeagent-native",
      { agentDefinitionId: "builtin:os_agent", model: "gpt-5" },
    ],
    [
      "sdeagent-custom",
      { agentIconId: "brain", agentDefinitionId: "custom:reviewer" },
    ],
    ["cliagent-managed", { cliAgentType: "claude_code" }],
    [
      "codexapp-imported",
      { externalHistorySource: "codex_app", model: "gpt-5" },
    ],
    ["claudecode-imported", { externalHistorySource: "claude_code" }],
  ])("uses the Desktop metadata resolver for %s", (id, display) => {
    const input = mobileSessionIconInput(id, display);
    const mobile = resolveSessionDisplayMetadata({
      kind: "local",
      session: input,
    });
    const desktop = resolveSessionDisplayMetadata({
      kind: "local",
      session: { session_id: id, ...display, importedFrom: input.importedFrom },
    });
    expect(mobile.agentIconId).toBe(desktop.agentIconId);
  });
  it("keeps old imported-ID fallback and ignores an unknown source alias", () => {
    const source = mobileSessionIconInput("codexapp-imported", {
      externalHistorySource: "future_source",
    });
    expect(source.importedFrom).toBeUndefined();
    expect(
      resolveSessionDisplayMetadata({ kind: "local", session: source })
        .agentIconId
    ).toBe(
      resolveSessionDisplayMetadata({
        kind: "local",
        session: { session_id: "codexapp-imported" },
      }).agentIconId
    );
  });
});
