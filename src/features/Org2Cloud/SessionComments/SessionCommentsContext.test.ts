// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComposerSnapshot } from "@src/components/ComposerInput";
import MarkdownLocalImage from "@src/components/MarkDown/MarkdownLocalImage";
import type { Session } from "@src/store/session";
import type { SmokeRoot } from "@src/test/reactSmokeHarness";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import {
  useIsSessionFileShared,
  useOpenSessionSharedFile,
} from "../SharedSessionFilesContext";
import type { Org2CloudAuthState } from "../org2CloudAuthAtom";
import { org2CloudAuthAtom } from "../org2CloudAuthAtom";
import type { CloudOrgMember } from "../org2CloudClient";
import {
  type CloudSessionComment,
  Org2CloudCommentError,
} from "../org2CloudCommentsClient";
import { SessionCommentDeliveryError } from "../org2CloudSessionCommentsAtom";
import {
  type SessionCommentsContextValue,
  SessionCommentsProvider,
  addCommentWithSessionAdmissionRecovery,
  buildCloudCommentRetryCasSteps,
  buildCloudCommentSourceEventIdMap,
  cloudCommentRetryAttemptKey,
  useSessionCommentsContext,
} from "./SessionCommentsContext";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  addComment: vi.fn(),
  getCloudCapabilities: vi.fn(),
  loadCloudOrgMembers: vi.fn(),
  ownerRun: vi.fn(),
  useSessionComments: vi.fn(),
}));

vi.mock("../org2CloudSessionCommentsAtom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org2CloudSessionCommentsAtom")>()),
  useSessionComments: mocks.useSessionComments,
}));

vi.mock("../sessionCommentTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sessionCommentTarget")>()),
  useSessionCommentTarget: (
    _session: unknown,
    targetOverride?: { orgId: string; sessionId: string } | null
  ) => targetOverride ?? null,
}));

vi.mock("../org2CloudMembersCoordinator", () => ({
  loadCloudOrgMembers: mocks.loadCloudOrgMembers,
}));

vi.mock("../org2CloudCapabilities", () => ({
  getCloudCapabilities: mocks.getCloudCapabilities,
}));

vi.mock("../useOwnedCloudCommentAgentRun", () => ({
  useOwnedCloudCommentAgentRun: () => ({
    available: false,
    run: mocks.ownerRun,
  }),
}));

vi.mock("@tauri-apps/plugin-fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/plugin-fs")>()),
  readFile: mocks.readFile,
}));

const LIVE_MESSAGE_ID = "70c0418c-eb0c-4a84-8a52-1bca10e605b7";

describe("buildCloudCommentSourceEventIdMap", () => {
  it("normalizes a transient Rust-native user UUID to its durable event id", () => {
    const mapping = buildCloudCommentSourceEventIdMap(
      { session_id: "s-1", category: "rust_agent" },
      [{ id: LIVE_MESSAGE_ID, source: "user" }]
    );

    expect(mapping.get(LIVE_MESSAGE_ID)).toBe(
      `user-message-${LIVE_MESSAGE_ID}`
    );
  });

  it("keeps persisted, seeded, non-user, and external-history ids unchanged", () => {
    const nativeMapping = buildCloudCommentSourceEventIdMap(
      { session_id: "s-1", category: "rust_agent" },
      [
        { id: `user-message-${LIVE_MESSAGE_ID}`, source: "user" },
        { id: "user-2-s-1", source: "user" },
        { id: LIVE_MESSAGE_ID, source: "assistant" },
      ]
    );
    const externalMapping = buildCloudCommentSourceEventIdMap(
      { session_id: "external-1", category: "external_history" },
      [{ id: LIVE_MESSAGE_ID, source: "user" }]
    );

    expect(nativeMapping.get(`user-message-${LIVE_MESSAGE_ID}`)).toBe(
      `user-message-${LIVE_MESSAGE_ID}`
    );
    expect(nativeMapping.get("user-2-s-1")).toBe("user-2-s-1");
    expect(nativeMapping.get(LIVE_MESSAGE_ID)).toBe(LIVE_MESSAGE_ID);
    expect(externalMapping.get(LIVE_MESSAGE_ID)).toBe(LIVE_MESSAGE_ID);
  });

  it("strips import and fork namespaces before matching cloud comments", () => {
    const importedSessionId = "imported-session-1";
    const importedEventId = `${importedSessionId}~user-message-${LIVE_MESSAGE_ID}`;
    const mapping = buildCloudCommentSourceEventIdMap(
      { session_id: importedSessionId, category: "external_history" },
      [{ id: importedEventId, source: "user" }]
    );

    expect(mapping.get(importedEventId)).toBe(
      `user-message-${LIVE_MESSAGE_ID}`
    );
  });
});

describe("addCommentWithSessionAdmissionRecovery", () => {
  it("repairs an owner admission race and retries the same Team Chat comment once", async () => {
    const comment = { id: "comment-1" } as never;
    const add = vi
      .fn<() => Promise<typeof comment>>()
      .mockRejectedValueOnce(
        new Org2CloudCommentError("ORG2_SESSION_NOT_FOUND", 404)
      )
      .mockResolvedValueOnce(comment);
    const repair = vi.fn(async () => undefined);

    await expect(
      addCommentWithSessionAdmissionRecovery(add, repair)
    ).resolves.toBe(comment);
    expect(repair).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("keeps the retained row's identity when admission repair itself fails", async () => {
    const retained = new SessionCommentDeliveryError(
      "local-comment-1",
      new Org2CloudCommentError("ORG2_SESSION_NOT_FOUND", 404)
    );
    const add = vi.fn(async () => {
      throw retained;
    });
    const repairError = new Error("sync pass rejected");
    const repair = vi.fn(async () => {
      throw repairError;
    });

    const rejection = await addCommentWithSessionAdmissionRecovery(
      add,
      repair
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(SessionCommentDeliveryError);
    expect((rejection as SessionCommentDeliveryError).commentId).toBe(
      "local-comment-1"
    );
    expect((rejection as SessionCommentDeliveryError).cause).toBe(repairError);
    expect(add).toHaveBeenCalledOnce();
  });

  it("does not recreate a missing imported teammate session", async () => {
    const error = new Org2CloudCommentError("ORG2_SESSION_NOT_FOUND", 404);
    const add = vi.fn(async () => {
      throw error;
    });

    await expect(
      addCommentWithSessionAdmissionRecovery(add, null)
    ).rejects.toBe(error);
    expect(add).toHaveBeenCalledOnce();
  });
});

describe("SessionCommentsProvider failed Team Chat retry", () => {
  const auth: Org2CloudAuthState = {
    kind: "org2_cloud",
    supabaseUrl: "https://cloud.example.test",
    supabaseAnonKey: "anon",
    userId: "viewer",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: 4_000_000_000,
  };
  const members: CloudOrgMember[] = [
    { userId: "alice", displayName: "Alice", role: "member", status: "active" },
    { userId: "bob", displayName: "Bob", role: "member", status: "active" },
  ];
  const failedComment: CloudSessionComment = {
    id: "optimistic-comment-1",
    eventId: "event-1",
    authorUserId: "viewer",
    body: "@Bob optimistic edit",
    createdAt: "2026-08-31T00:00:00.000Z",
    kind: "user",
    mentionedUserIds: ["bob"],
    clientDeliveryStatus: "failed",
    clientRetryExpectedBody: "@Alice original body",
    clientRetryExpectedMentionedUserIds: ["alice"],
  };
  let root: SmokeRoot | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadCloudOrgMembers.mockResolvedValue({ auth, members });
    mocks.getCloudCapabilities.mockResolvedValue({
      teamInboxMentions: true,
    });
  });

  afterEach(async () => {
    await root?.unmount();
    root = null;
  });

  it("reconciles a lost edited response before a later edit and claims one retry", async () => {
    let resolveAdd!: (comment: CloudSessionComment) => void;
    const addPromise = new Promise<CloudSessionComment>((resolve) => {
      resolveAdd = resolve;
    });
    mocks.addComment.mockReturnValue(addPromise);
    mocks.useSessionComments.mockReturnValue({
      comments: [failedComment],
      viewerOwnsSession: false,
      state: "ready",
      refresh: vi.fn(),
      addComment: mocks.addComment,
      editComment: vi.fn(),
      deleteComment: vi.fn(),
      resolveComment: vi.fn(),
    });

    const captureContext =
      vi.fn<(value: SessionCommentsContextValue | null) => void>();
    const Harness = () => {
      const context = useSessionCommentsContext();
      useEffect(() => captureContext(context), [context]);
      return createElement("output", {
        "data-members": context?.mentionableMembers.length ?? 0,
      });
    };
    const store = createStore();
    store.set(org2CloudAuthAtom, auth);
    root = createSmokeRoot();
    await root.render(
      createElement(
        Provider,
        { store },
        createElement(
          SessionCommentsProvider,
          {
            session: null,
            targetOverride: { orgId: "org-1", sessionId: "session-1" },
            events: null,
          },
          createElement(Harness)
        )
      )
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      root.container.querySelector("output")?.getAttribute("data-members")
    ).toBe("2");
    const getContext = () => {
      const context = captureContext.mock.lastCall?.[0] ?? null;
      if (!context) {
        throw new Error("Session comments context was not mounted");
      }
      return context;
    };

    const editedMentionSnapshot: ComposerSnapshot = {
      parts: [
        {
          kind: "pill",
          attrs: {
            filePath: "member://bob",
            fileName: "Former Bob",
            isFolder: false,
            iconType: "member",
            lineStart: null,
            lineEnd: null,
          },
        },
        { kind: "text", text: " edited body" },
      ],
    };
    const first = getContext().retryComment(
      failedComment.id,
      "@Former Bob edited body",
      editedMentionSnapshot
    );
    const duplicate = getContext().retryComment(
      failedComment.id,
      "@Alice duplicate body"
    );

    expect(mocks.addComment).toHaveBeenCalledOnce();
    expect(mocks.addComment).toHaveBeenCalledWith({
      body: failedComment.body,
      eventId: "event-1",
      parentId: undefined,
      mentionedUserIds: failedComment.mentionedUserIds,
      optimisticId: failedComment.id,
      replaceExisting: true,
      expectedBody: failedComment.clientRetryExpectedBody,
      expectedMentionedUserIds:
        failedComment.clientRetryExpectedMentionedUserIds,
    });

    resolveAdd({
      ...failedComment,
      clientDeliveryStatus: "sent",
    });
    await Promise.all([first, duplicate]);
    expect(mocks.addComment).toHaveBeenCalledTimes(2);
    expect(mocks.addComment).toHaveBeenNthCalledWith(2, {
      body: "@Former Bob edited body",
      eventId: "event-1",
      parentId: undefined,
      mentionedUserIds: ["bob"],
      optimisticId: failedComment.id,
      replaceExisting: true,
      expectedBody: failedComment.body,
      expectedMentionedUserIds: failedComment.mentionedUserIds,
    });
  });

  it("plans one-step and two-step CAS retries from the durable baseline", () => {
    expect(
      buildCloudCommentRetryCasSteps({
        failed: failedComment,
        nextBody: "@Alice final edit",
        nextMentionedUserIds: ["alice"],
        edited: true,
      })
    ).toEqual([
      {
        body: failedComment.body,
        mentionedUserIds: ["bob"],
        replaceExisting: true,
        expectedBody: "@Alice original body",
        expectedMentionedUserIds: ["alice"],
      },
      {
        body: "@Alice final edit",
        mentionedUserIds: ["alice"],
        replaceExisting: true,
        expectedBody: failedComment.body,
        expectedMentionedUserIds: ["bob"],
      },
    ]);

    expect(
      buildCloudCommentRetryCasSteps({
        failed: failedComment,
        nextBody: failedComment.body,
        nextMentionedUserIds: ["bob"],
        edited: false,
      })
    ).toEqual([
      {
        body: failedComment.body,
        mentionedUserIds: ["bob"],
        replaceExisting: true,
        expectedBody: "@Alice original body",
        expectedMentionedUserIds: ["alice"],
      },
    ]);

    expect(
      buildCloudCommentRetryCasSteps({
        failed: {
          body: "@Alice original body",
          mentionedUserIds: ["alice"],
        },
        nextBody: "@Bob first edit",
        nextMentionedUserIds: ["bob"],
        edited: true,
      })
    ).toEqual([
      {
        body: "@Bob first edit",
        mentionedUserIds: ["bob"],
        replaceExisting: true,
        expectedBody: "@Alice original body",
        expectedMentionedUserIds: ["alice"],
      },
    ]);
  });

  it("keeps retries isolated across endpoint/account identities", () => {
    const base = {
      orgId: "org-1",
      sessionId: "session-1",
      commentId: "comment-1",
    };
    expect(
      cloudCommentRetryAttemptKey({
        ...base,
        authIdentityKey: "https://cloud-a.test|viewer",
      })
    ).not.toBe(
      cloudCommentRetryAttemptKey({
        ...base,
        authIdentityKey: "https://cloud-b.test|viewer",
      })
    );
    expect(
      cloudCommentRetryAttemptKey({
        ...base,
        authIdentityKey: "https://cloud-a.test|viewer",
      })
    ).not.toBe(
      cloudCommentRetryAttemptKey({
        ...base,
        authIdentityKey: "https://cloud-a.test|other-user",
      })
    );
  });
});

vi.mock("../SharedSessionFileViewer", () => ({
  default: ({
    reference,
  }: {
    reference: { endpoint: string; source: { sessionId: string } };
  }) =>
    createElement("output", {
      "data-file-endpoint": reference.endpoint,
      "data-file-session": reference.source.sessionId,
    }),
}));

describe("shared-file navigation origin", () => {
  let root: SmokeRoot;
  const auth = {
    kind: "org2_cloud" as const,
    supabaseUrl: "https://cloud.example",
    supabaseAnonKey: "anon",
    userId: "u1",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: 9999999999,
  };
  const local = {
    session_id: "local",
    category: "rust_agent",
    repoPath: "/workspace",
    orgId: "cloud:org-1",
  } as Session;
  const imported = {
    ...local,
    importedFrom: {
      orgId: "org-1",
      sourceSessionId: "remote",
      sourceEndpointUrl: "https://source.example",
      ownerMemberId: "owner",
      epoch: 1,
      seq: 0,
      count: 1,
    },
  } as Session;
  const localOpen = vi.fn();
  function FileAction() {
    const shared = useIsSessionFileShared();
    const open = useOpenSessionSharedFile();
    return createElement(
      "button",
      {
        "data-shared": String(shared),
        onClick: () => {
          if (!open("report.md")) localOpen();
        },
      },
      "Open file"
    );
  }
  beforeEach(() => {
    localOpen.mockClear();
    mocks.readFile.mockReset();
    root = createSmokeRoot();
    mocks.useSessionComments.mockReturnValue({
      comments: [],
      state: "ready",
      refresh: vi.fn(),
      addComment: vi.fn(),
      editComment: vi.fn(),
      deleteComment: vi.fn(),
      resolveComment: vi.fn(),
    });
    mocks.loadCloudOrgMembers.mockResolvedValue({ auth, members: [] });
    mocks.getCloudCapabilities.mockResolvedValue({});
  });
  afterEach(async () => root.unmount());
  async function render(
    store: ReturnType<typeof createStore>,
    session: Session,
    target: { orgId: string; sessionId: string } | null
  ) {
    await root.render(
      createElement(
        Provider,
        { store },
        createElement(
          SessionCommentsProvider,
          { session, targetOverride: target, events: null },
          createElement(FileAction),
          session.importedFrom
            ? createElement(MarkdownLocalImage, {
                src: "/workspace/report.png",
                alt: "remote image",
              })
            : null
        )
      )
    );
  }
  async function click() {
    await act(async () => {
      (root.container.querySelector("button") as HTMLButtonElement).click();
    });
  }
  it("keeps remote paths remote after logout and comment-target loss", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, auth);
    await render(store, imported, { orgId: "org-1", sessionId: "remote" });
    await act(async () => {
      store.set(org2CloudAuthAtom, null);
    });
    await render(store, imported, null);
    expect(
      root.container.querySelector("button")?.getAttribute("data-shared")
    ).toBe("true");
    await click();
    expect(localOpen).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(
      root.container.querySelector("output")?.getAttribute("data-file-endpoint")
    ).toBe("https://source.example");
    expect(
      root.container.querySelector("output")?.getAttribute("data-file-session")
    ).toBe("remote");
  });
  it.each([
    local,
    {
      ...local,
      forkedFrom: { orgId: "org-1", sourceSessionId: "parent" },
    } as Session,
  ])(
    "keeps local and writable-fork files local despite a comment target",
    async (session) => {
      const store = createStore();
      store.set(org2CloudAuthAtom, auth);
      await render(store, session, { orgId: "org-1", sessionId: "parent" });
      expect(
        root.container.querySelector("button")?.getAttribute("data-shared")
      ).toBe("false");
      await click();
      expect(localOpen).toHaveBeenCalledOnce();
      expect(root.container.querySelector("output")).toBeNull();
    }
  );
  it("does not resolve legacy remote origins against a newly selected endpoint", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, auth);
    await render(
      store,
      {
        ...imported,
        importedFrom: {
          ...imported.importedFrom!,
          sourceEndpointUrl: undefined,
        },
      },
      null
    );
    await click();
    expect(localOpen).not.toHaveBeenCalled();
    expect(
      root.container.querySelector("output")?.getAttribute("data-file-endpoint")
    ).toBe("");
  });
});
