import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  QueuedConversationRecoveryPendingError,
  QueuedConversationTurnClosedError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { Org2CloudConversationError } from "@src/features/Org2Cloud/org2CloudConversationEventsClient";
import { org2CloudRemoteSessionsAtom } from "@src/features/Org2Cloud/org2CloudRemoteSessionsAtom";
import { sessionsAtom } from "@src/store/session";

import { dispatchQueuedCloudConversation } from "./cloudConversationQueueAdapter";

const mocks = vi.hoisted(() => ({
  refreshAuth: vi.fn(),
  capabilities: vi.fn(),
  pushEvents: vi.fn(),
  refreshPlane: vi.fn(),
  runConversationTurn: vi.fn(),
  listComments: vi.fn(),
  loadCanonical: vi.fn(),
  importRemote: vi.fn(),
  buildFetchClient: vi.fn(),
}));

vi.mock(
  "@src/engines/SessionCore/conversations/canonicalConversationEvents",
  () => ({ loadCanonicalConversationEvents: mocks.loadCanonical })
);

vi.mock("@src/features/Org2Cloud/org2CloudCommentsClient", () => ({
  listSessionComments: mocks.listComments,
}));

vi.mock("@src/features/Org2Cloud/org2CloudBackendAdapter", () => ({
  buildCloudSessionFetchClient: mocks.buildFetchClient,
}));

vi.mock("@src/features/TeamCollaboration/engine/collabSessionImport", () => ({
  importRemoteSession: mocks.importRemote,
}));

vi.mock("@src/features/Org2Cloud/org2CloudAuthAction", () => ({
  refreshOrg2CloudAuthForAction: mocks.refreshAuth,
}));

vi.mock("@src/features/Org2Cloud/org2CloudCapabilities", () => ({
  getCloudCapabilitiesConfirmed: mocks.capabilities,
}));

vi.mock(
  "@src/features/Org2Cloud/org2CloudConversationEventsClient",
  async (importOriginal) => ({
    ...(await importOriginal()),
    pushConversationEventsChunked: mocks.pushEvents,
  })
);

vi.mock("./conversationPlaneAtom", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshConversationPlaneEntry: mocks.refreshPlane,
}));

vi.mock("./conversationTurnRunner", async (importOriginal) => ({
  ...(await importOriginal()),
  runConversationTurn: mocks.runConversationTurn,
}));

const AUTH = {
  kind: "org2_cloud" as const,
  supabaseUrl: "https://cloud.example",
  supabaseAnonKey: "anon",
  userId: "user-1",
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: 4_000_000_000,
};

const ROOT = {
  authority: "org2-cloud" as const,
  authorityScope: ["https://cloud.example", "org-1"],
  conversationId: "shared-root",
};

const MESSAGE = {
  id: "message-1",
  turnIntentId: "turn-1",
  sessionId: "imported-session",
  content: "continue",
  displayContent: "continue",
  status: "preparing" as const,
  conversationDispatch: {
    kind: "canonical_conversation" as const,
    root: ROOT,
    target: {
      cliAgentType: "codex" as const,
      accountId: "openai-1",
      model: "gpt-5.6-sol",
    },
    dispatchIdentityKey: "https://cloud.example|user-1",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshAuth.mockImplementation(async (auth) => ({
    status: "ready",
    auth,
  }));
  mocks.capabilities.mockResolvedValue({
    confirmed: true,
    capabilities: {
      conversationEvents: true,
      conversationEventsIdempotency: true,
    },
  });
  mocks.pushEvents.mockResolvedValue({ firstSeq: 1, lastSeq: 1 });
  mocks.listComments.mockResolvedValue({ comments: [] });
  mocks.buildFetchClient.mockReturnValue({});
  mocks.importRemote.mockResolvedValue({
    localSessionId: "imported-fork",
    updated: true,
  });
  mocks.loadCanonical.mockImplementation(async (sessionId: string) => ({
    source: "native_store",
    events:
      sessionId === "root"
        ? [
            {
              id: "root-pre-plane",
              chunk_id: "root-pre-plane",
              sessionId,
              createdAt: "2026-08-20T09:00:00Z",
              functionName: "assistant_message",
              uiCanonical: "assistant_message",
              actionType: "assistant",
              args: {},
              result: {},
              source: "assistant",
              displayText: "root history",
              displayStatus: "completed",
              displayVariant: "message",
              activityStatus: "agent",
              payloadRefs: [],
            },
          ]
        : [
            {
              id: "fork-pre-plane",
              chunk_id: "fork-pre-plane",
              sessionId,
              createdAt: "2026-08-20T10:00:00Z",
              functionName: "assistant_message",
              uiCanonical: "assistant_message",
              actionType: "assistant",
              args: {},
              result: {},
              source: "assistant",
              displayText: "fork history",
              displayStatus: "completed",
              displayVariant: "message",
              activityStatus: "agent",
              payloadRefs: [],
            },
          ],
  }));
});

describe("dispatchQueuedCloudConversation failure classification", () => {
  it("publishes one terminal event and closes after a definitive post-admission 4xx", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    mocks.refreshPlane.mockRejectedValueOnce(
      new Org2CloudConversationError("ORG2_FORBIDDEN", 403)
    );

    await expect(
      dispatchQueuedCloudConversation(store, MESSAGE, ROOT, {
        onAccepted: vi.fn(),
      })
    ).rejects.toBeInstanceOf(QueuedConversationTurnClosedError);

    expect(mocks.pushEvents).toHaveBeenCalledTimes(2);
    expect(mocks.pushEvents.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        turnId: "turn-1",
        events: [
          expect.objectContaining({
            source: "system",
            displayStatus: "failed",
          }),
        ],
      })
    );
    expect(mocks.runConversationTurn).not.toHaveBeenCalled();
  });

  it("retains recovery ownership after a retryable post-admission 5xx", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    mocks.refreshPlane.mockRejectedValueOnce(
      new Org2CloudConversationError("temporary upstream failure", 503)
    );

    await expect(
      dispatchQueuedCloudConversation(store, MESSAGE, ROOT, {
        onAccepted: vi.fn(),
      })
    ).rejects.toBeInstanceOf(QueuedConversationRecoveryPendingError);

    expect(mocks.pushEvents).toHaveBeenCalledOnce();
    expect(mocks.runConversationTurn).not.toHaveBeenCalled();
  });

  it("imports every available family member before executing the canonical timeline", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    store.set(sessionsAtom, [
      {
        session_id: "shared-root",
        name: "Root",
        status: "completed",
        created_at: "2026-08-20T09:00:00Z",
        updated_at: "2026-08-20T09:00:00Z",
      },
    ]);
    store.set(org2CloudRemoteSessionsAtom, {
      "org-1": {
        identityKey: "https://cloud.example|user-1",
        state: "ready",
        fetchedAt: 1,
        rows: [
          {
            id: "row-root",
            orgId: "org-1",
            ownerMemberId: "member-1",
            ownerUserId: "user-1",
            ownerDisplayName: "Owner",
            ownerIdentityKind: "human",
            sourceSessionId: "shared-root",
            title: "Root",
            eventsEpoch: 1,
            eventsFrozenSeq: 0,
            eventsCount: 1,
            eventsTailHash: "root-tail",
          },
          {
            id: "row-fork",
            orgId: "org-1",
            ownerMemberId: "member-2",
            ownerUserId: "user-2",
            ownerDisplayName: "Teammate",
            ownerIdentityKind: "human",
            sourceSessionId: "fork-1",
            title: "Fork",
            eventsEpoch: 1,
            eventsFrozenSeq: 0,
            eventsCount: 1,
            eventsTailHash: "fork-tail",
            forkedFrom: {
              sourceSessionId: "shared-root",
              rootSessionId: "shared-root",
              forkedAt: "2026-08-20T10:00:00Z",
            },
          },
        ],
      },
    });
    mocks.loadCanonical.mockImplementation(async (sessionId: string) => ({
      source: "native_store",
      events: [
        {
          id:
            sessionId === "imported-fork" ? "fork-pre-plane" : "root-pre-plane",
          chunk_id: "chunk",
          sessionId,
          createdAt:
            sessionId === "imported-fork"
              ? "2026-08-20T10:00:00Z"
              : "2026-08-20T09:00:00Z",
          functionName: "assistant_message",
          uiCanonical: "assistant_message",
          actionType: "assistant",
          args: {},
          result: {},
          source: "assistant",
          displayText: sessionId,
          displayStatus: "completed",
          displayVariant: "message",
          activityStatus: "agent",
          payloadRefs: [],
        },
      ],
    }));
    mocks.refreshPlane.mockResolvedValue({
      state: "ready",
      events: [],
    });
    mocks.listComments.mockResolvedValue({
      comments: [
        {
          id: "discussion-1",
          authorUserId: "user-2",
          authorDisplayName: "Teammate",
          body: "team context",
          createdAt: "2026-08-20T10:01:00Z",
        },
      ],
    });
    mocks.runConversationTurn.mockResolvedValue({
      runnerSessionId: "runner",
      terminalStatus: "completed",
    });

    await dispatchQueuedCloudConversation(store, MESSAGE, ROOT, {
      onAccepted: vi.fn(),
    });

    expect(mocks.importRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        remoteSession: expect.objectContaining({ sourceSessionId: "fork-1" }),
      })
    );
    const timeline = mocks.runConversationTurn.mock.calls[0]?.[0]
      ?.timeline as Array<{ id: string; source: string; args: unknown }>;
    expect(timeline.map((event) => event.id)).toEqual(
      expect.arrayContaining([
        "root-pre-plane",
        "fork-pre-plane",
        "session-discussion-discussion-1",
      ])
    );
    expect(
      timeline.find((event) => event.id === "session-discussion-discussion-1")
    ).toMatchObject({
      source: "user",
      args: {
        conversationSender: {
          userId: "user-2",
          displayName: "Teammate",
        },
      },
    });
  });
});
