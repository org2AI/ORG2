// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useConversationTargetBinding } from "./useConversationTargetBinding";

const mocks = vi.hoisted(() => ({
  session: {
    session_id: "sdeagent-package",
    agentDefinitionId: "builtin:sde",
    credentialSource: "market:only-source",
    model: "gpt",
    repoPath: "/repo",
  },
  picks: vi.fn(() => ({ applyModelPick: vi.fn(), applyRuntimePick: vi.fn() })),
}));
vi.mock("jotai", async (original) => ({
  ...(await original<typeof import("jotai")>()),
  useAtomValue: (atom: string) =>
    atom === "sessions" ? [mocks.session] : mocks.session,
}));
vi.mock("@src/store/session/sessionAtom/atoms", () => ({
  sessionsAtom: "sessions",
  sessionByIdAtom: () => "session",
}));
vi.mock("@src/hooks/models/useModelAccountLookup", () => ({
  useModelAccountLookup: () => ({ accounts: [], hasLoaded: true }),
}));
vi.mock("@src/hooks/models/useAgentCompatibility", () => ({
  useAgentCompatibility: () => ({
    registry: { agents: [], apiProviders: [] },
    discoveryState: "ready",
  }),
}));
vi.mock("@src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions", () => ({
  useAgentDefinitions: () => ({
    builtInAgents: [{ id: "builtin:sde", name: "SDE" }],
    agents: [],
  }),
}));
vi.mock("./conversationTargetBinding/useConversationCloudTarget", () => ({
  useConversationCloudTarget: () => ({ cloudSource: {} }),
}));
vi.mock("./conversationTargetBinding/useConversationExecutionTargets", () => ({
  useConversationExecutionTargets: () => ({
    executionTargets: [],
    previousTargets: [],
    executionTargetHydrationLoading: false,
    executionTargetHydrationFailed: false,
    preferredTarget: null,
  }),
}));
vi.mock("./conversationTargetBinding/useConversationTargetPicks", () => ({
  useConversationTargetPicks: mocks.picks,
}));
vi.mock("./conversationTargetBinding/useMarketTargetPresentation", () => ({
  useMarketTargetPresentation: (selection: unknown) => selection,
}));

it("keeps the SDE model picker usable with a Package and no KeyVault or installed CLI", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  let current: ReturnType<typeof useConversationTargetBinding> = null;
  function Probe() {
    const value = useConversationTargetBinding("sdeagent-package");
    useEffect(() => {
      current = value;
    }, [value]);
    return null;
  }
  act(() => root.render(React.createElement(Probe)));
  const read = () => current;
  expect(read()?.readiness).toBe("ready");
  expect(read()?.nativeCliTargets).toEqual([]);
  expect(read()?.target).toMatchObject({
    agentDefinitionId: "builtin:sde",
    credentialSource: "market:only-source",
    model: "gpt",
  });
  expect(mocks.picks).toHaveBeenCalledWith(
    expect.objectContaining({
      readiness: "ready",
      accounts: [],
      nativeCliTargets: [],
    })
  );
  act(() => root.unmount());
});
