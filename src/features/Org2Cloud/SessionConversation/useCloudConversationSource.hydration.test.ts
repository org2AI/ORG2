// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { reposHydratedAtom } from "@src/store/repo";
import type { Session } from "@src/store/session";

import { org2CloudRemoteSessionsAtom } from "../org2CloudRemoteSessionsAtom";
import { useCloudConversationSource } from "./useCloudConversationSource";

vi.mock("@src/features/TeamCollaboration/forkWorkspaceResolution", () => ({
  resolveForkWorkspacePath: vi.fn(async () => null),
}));
vi.mock("@src/features/Org2Cloud/useCloudSessionDownloadSurface", () => ({
  useCloudSessionLoadingSource: () => undefined,
}));

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

it("keeps an imported checkout unresolved until remote metadata and the repo inventory finish loading", async () => {
  const orgId = "cloud-org";
  const sourceSessionId = "source-session";
  const session = {
    session_id: "local-import",
    importedFrom: {
      orgId,
      sourceSessionId,
      ownerMemberId: "member-1",
      epoch: 1,
      seq: 1,
      count: 2,
    },
  } as Session;
  const remoteRow = {
    id: "remote-row",
    orgId,
    sourceSessionId,
    repoScopeKey: "github.com/example/unique-repo",
    repoPath: "/source-machine/repo",
  } as RemoteTeammateSessionMetadata;
  const store = createStore();
  store.set(org2CloudRemoteSessionsAtom, {
    [orgId]: { state: "loading", rows: [], fetchedAt: 0 },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const observedRef: {
    current: ReturnType<typeof useCloudConversationSource> | null;
  } = { current: null };
  function Probe() {
    const result = useCloudConversationSource({
      sessionId: session.session_id,
      session,
      target: { orgId, sessionId: sourceSessionId },
      sessions: [session],
      repos: [],
    });
    useEffect(() => {
      observedRef.current = result;
    }, [result]);
    return null;
  }

  await act(async () => {
    root.render(createElement(Provider, { store }, createElement(Probe)));
  });
  expect(observedRef.current?.workspacePending).toBe(true);

  await act(async () => {
    store.set(org2CloudRemoteSessionsAtom, {
      [orgId]: { state: "ready", rows: [remoteRow], fetchedAt: 1 },
    });
  });
  expect(observedRef.current?.workspacePending).toBe(true);

  await act(async () => {
    store.set(reposHydratedAtom, true);
  });
  expect(observedRef.current?.workspacePending).toBe(false);
  expect(observedRef.current?.source?.workspaceRepoPath).toBe(null);

  act(() => root.unmount());
  container.remove();
});
