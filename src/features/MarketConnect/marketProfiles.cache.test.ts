// @vitest-environment jsdom
import { Provider } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { USER_B, authFor, signedInStore } from "./identity.test-utils";
import {
  invalidateMarketProfileCache,
  useMarketExecutionProfiles,
} from "./marketProfiles";
import type { Entry } from "./rpc";

const mocks = vi.hoisted(() => ({
  loadConnections: vi.fn(),
  loadEntries: vi.fn(),
}));
vi.mock("./rpc", () => ({ ...mocks, prepareSessionSource: vi.fn() }));
vi.mock("./usageAuthorization", () => ({ authorizedProfile: vi.fn() }));
const cleanup: Array<() => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  signedInStore();
  invalidateMarketProfileCache();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.loadConnections.mockResolvedValue({
    connections: [
      {
        identity_user_id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "ws_account_test",
        target: "org2",
        phase: "authorization_saved",
      },
    ],
  });
  mocks.loadEntries.mockResolvedValue([]);
});
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

function picker() {
  let enabled = true;
  let current: ReturnType<typeof useMarketExecutionProfiles>;
  const root = createRoot(document.createElement("div"));
  function Probe() {
    const value = useMarketExecutionProfiles({
      enabled,
      cliAgentType: "claude_code",
    });
    useEffect(() => {
      current = value;
    }, [value]);
    return null;
  }
  cleanup.push(() => act(() => root.unmount()));
  return {
    async render(open: boolean) {
      enabled = open;
      await act(async () => {
        root.render(
          React.createElement(
            Provider,
            { store: getInstrumentedStore() },
            React.createElement(Probe)
          )
        );
      });
      return current!;
    },
  };
}

it("refreshes website package changes on app focus without a deep link or idle fetch", async () => {
  const view = picker();
  expect((await view.render(true)).profiles).toEqual([]);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
  await view.render(false);
  const entry: Entry = {
    workspace_id: "ws_purchase",
    entitlement_id: "pa_selected",
    service_id: "package-selected",
    service_name: "Selected Package",
    models: ["claude-sonnet-5"],
    models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
    status: "active",
    expires_at: null,
  };
  mocks.loadEntries.mockResolvedValue([entry]);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
  expect(
    (await view.render(true)).profiles.map((profile) => profile.entitlementId)
  ).toEqual(["pa_selected"]);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
  await view.render(false);
  await view.render(true);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
});

it("projects identical package/model names as distinct picker sources with their original purchase bindings", async () => {
  const entries: Entry[] = ["b", "a"].map((suffix) => ({
    workspace_id: `ws_purchase_${suffix}`,
    entitlement_id: `pa_${suffix}`,
    service_id: `package_${suffix}`,
    service_name: "Claude Package",
    models: ["claude-sonnet-5"],
    models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
    status: "active",
    expires_at: null,
  }));
  mocks.loadEntries.mockResolvedValue(entries);
  const result = await picker().render(true);
  expect(
    result.sources.map((source) => ({
      label: source.label,
      workspace: source.profile.entitlementWorkspaceId,
      purchase: source.profile.entitlementId,
    }))
  ).toEqual([
    {
      label: "Claude Package · 2/2",
      workspace: "ws_purchase_b",
      purchase: "pa_b",
    },
    {
      label: "Claude Package · 1/2",
      workspace: "ws_purchase_a",
      purchase: "pa_a",
    },
  ]);
  expect(new Set(result.sources.map((source) => source.id)).size).toBe(2);
});

it("hides a rendered old-owner catalog immediately and loads only the new owner's entries", async () => {
  mocks.loadEntries.mockResolvedValue([
    {
      workspace_id: "ws_purchase",
      entitlement_id: "pa_one",
      service_id: "pkg_one",
      service_name: "One",
      models: ["gpt"],
      models_by_agent: { claude: ["gpt"], codex: [] },
      status: "active",
      expires_at: null,
    },
  ]);
  const view = picker();
  expect((await view.render(true)).profiles).toHaveLength(1);
  await act(async () => {
    getInstrumentedStore().set(org2CloudAuthAtom, authFor(USER_B));
  });
  expect((await view.render(true)).profiles).toEqual([]);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
  await act(async () => {
    getInstrumentedStore().set(org2CloudAuthAtom, null);
  });
  const loggedOut = await view.render(true);
  expect(loggedOut.profiles).toEqual([]);
  expect(loggedOut.loading).toBe(false);
});

it("invalidates already rendered rows through a React-batched A to B to A transition", async () => {
  mocks.loadEntries.mockResolvedValue([
    {
      workspace_id: "ws_purchase",
      entitlement_id: "pa_one",
      service_id: "pkg_one",
      service_name: "One",
      models: ["gpt"],
      models_by_agent: { claude: ["gpt"], codex: [] },
      status: "active",
      expires_at: null,
    },
  ]);
  const view = picker();
  expect((await view.render(true)).profiles).toHaveLength(1);
  mocks.loadEntries.mockResolvedValue([]);
  await act(async () => {
    getInstrumentedStore().set(org2CloudAuthAtom, authFor(USER_B));
    getInstrumentedStore().set(org2CloudAuthAtom, authFor());
  });
  expect((await view.render(true)).profiles).toEqual([]);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
});

for (const secondEnabled of [false, true]) {
  it(`shares one focus refresh with another ${secondEnabled ? "open" : "closed"} picker`, async () => {
    const first = picker();
    const second = picker();
    await first.render(true);
    await second.render(secondEnabled);
    expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
    mocks.loadEntries.mockResolvedValue([
      {
        workspace_id: "ws_purchase",
        entitlement_id: "pa_focused",
        service_id: "pkg_focused",
        service_name: "Focused package",
        models: ["claude-sonnet-5"],
        models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
        status: "active",
        expires_at: null,
      },
    ]);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(
      (await first.render(true)).profiles.map(
        (profile) => profile.entitlementId
      )
    ).toEqual(["pa_focused"]);
    expect(
      (await second.render(true)).profiles.map(
        (profile) => profile.entitlementId
      )
    ).toEqual(["pa_focused"]);
    expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
  });
}
