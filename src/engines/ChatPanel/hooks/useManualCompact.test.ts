// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import { ConversationExecutionBindingContext } from "../ConversationExecutionBindingContext";
import type { ConversationTargetBinding } from "../conversationTargetSelection";
import { useManualCompact } from "./useManualCompact";

const mocks = vi.hoisted(() => ({ compact: vi.fn(), info: vi.fn() }));
vi.mock("@src/api/tauri/agent/session", () => ({
  manualCompactSession: mocks.compact,
}));
vi.mock("@src/components/Message", () => ({
  Message: { info: mocks.info, success: vi.fn(), error: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../InputArea/components/useContextUsageInfo", () => ({
  formatTokenCount: (n: number) => String(n),
}));

describe("manual compaction runtime ownership", () => {
  let root: SmokeRoot;
  let run: ReturnType<typeof useManualCompact>["runManualCompact"];
  function Probe() {
    const { runManualCompact } = useManualCompact();
    useEffect(() => {
      run = runManualCompact;
    }, [runManualCompact]);
    return null;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compact.mockResolvedValue({ status: "too_short" });
    root = createSmokeRoot();
  });
  afterEach(async () => {
    await root.unmount();
  });
  async function submit(binding: ConversationTargetBinding | null) {
    await root.render(
      createElement(
        Provider,
        { store: createStore() },
        createElement(
          ConversationExecutionBindingContext.Provider,
          { value: binding },
          createElement(Probe)
        )
      )
    );
    await act(async () => {
      await run("sdeagent-root", "keep the repository decisions");
    });
  }
  it("does not call Agent maintenance for an Agent root whose selected runtime is Claude", async () => {
    await submit({
      readiness: "ready",
      target: { cliAgentType: "claude_code" },
      appOpenSessionId: "cliagent-child",
    } as ConversationTargetBinding);
    expect(mocks.compact).not.toHaveBeenCalled();
  });
  it("does not compact an old root while the new Agent target has not executed", async () => {
    await submit({
      readiness: "ready",
      target: { agentDefinitionId: "builtin:sde" },
      appOpenSessionId: "cliagent-child",
    } as ConversationTargetBinding);
    expect(mocks.compact).not.toHaveBeenCalled();
  });
  it("waits for execution hydration instead of guessing from the root prefix", async () => {
    await submit({
      readiness: "loading",
      target: null,
      appOpenSessionId: null,
    } as ConversationTargetBinding);
    expect(mocks.compact).not.toHaveBeenCalled();
  });
  it("calls the existing Agent maintenance boundary when this root owns execution", async () => {
    await submit({
      readiness: "ready",
      target: { agentDefinitionId: "builtin:sde" },
      appOpenSessionId: "sdeagent-root",
    } as ConversationTargetBinding);
    expect(mocks.compact).toHaveBeenCalledWith(
      "sdeagent-root",
      "keep the repository decisions"
    );
  });
  it("preserves the legacy standalone Agent entry point", async () => {
    await submit(null);
    expect(mocks.compact).toHaveBeenCalledWith(
      "sdeagent-root",
      "keep the repository decisions"
    );
  });
});
