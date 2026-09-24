// @vitest-environment jsdom
// Audit counterexamples: passing proves the current gap, not the desired behavior.
import { beforeEach, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  applyCloudReplaySharePolicy,
  assertCloudReplayPublished,
} from "@src/features/Org2Cloud/CloudSessionShareDialog/sharePreparation";
import { resolveCloudPushAccess } from "@src/features/Org2Cloud/org2CloudAccessSettings";
import { collectSessionSharedFiles } from "@src/features/Org2Cloud/sessionSharedFileCandidates";
import { syncSessionSharedFiles } from "@src/features/Org2Cloud/syncSessionSharedFiles";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

const mocks = vi.hoisted(() => ({ read: vi.fn(), upload: vi.fn() }));
vi.mock("@src/features/Org2Cloud/org2CloudCapabilities", () => ({
  getCloudCapabilitiesConfirmed: async () => ({
    confirmed: true,
    capabilities: { sharedSessionFiles: true },
  }),
}));
vi.mock("@src/features/Org2Cloud/prepareSharedCommentFiles", () => ({
  readBoundedFile: mocks.read,
}));
vi.mock(
  "@src/features/Org2Cloud/sharedSessionFilesClient",
  async (original) => ({
    ...(await original<
      typeof import("@src/features/Org2Cloud/sharedSessionFilesClient")
    >()),
    findSharedSessionFileRevisions: async () => new Set(),
    uploadSharedSessionFile: mocks.upload,
  })
);

function event(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: "event-1",
    createdAt: "2026-09-24T00:00:00Z",
    source: "assistant",
    displayStatus: "completed",
    displayVariant: "tool_call",
    uiCanonical: "write_file",
    functionName: "write_file",
    actionType: "tool_call",
    displayText: "",
    filePath: "/workspace/report.md",
    args: {},
    result: {},
    ...overrides,
  } as SessionEvent;
}
beforeEach(() => vi.resetAllMocks());

it("directed-share preparation from defaults publishes org-wide full replay", () => {
  const { next } = applyCloudReplaySharePolicy({}, "org", "session");
  expect(resolveCloudPushAccess(next.org, "session", false)).toEqual({
    accessMode: "full_replay",
    visibility: "org",
  });
});

it("publication acknowledgement accepts a row without any source revision proof", () => {
  const stale = {
    sourceSessionId: "session",
    ownerUserId: "owner",
    accessMode: "full_replay",
    eventsEpoch: 1,
    eventsCount: 0,
  } as RemoteTeammateSessionMetadata;
  expect(() =>
    assertCloudReplayPublished([stale], "session", "owner")
  ).not.toThrow();
});

it("assistant prose can opt an arbitrary absolute local path into upload", () => {
  const result = collectSessionSharedFiles(
    [
      event({
        filePath: undefined,
        uiCanonical: "message",
        functionName: "message",
        displayVariant: "message",
        displayText: "[diagnostics](/outside-workspace/private-config.txt)",
      }),
    ],
    "/workspace"
  );
  expect(result.map((file) => file.path)).toEqual([
    "/outside-workspace/private-config.txt",
  ]);
});

it("multiple historical writes collapse to one path and the last event revision", () => {
  const result = collectSessionSharedFiles([event(), event({ id: "event-2" })]);
  expect(result).toEqual([
    { path: "/workspace/report.md", revision: "event-2:2026-09-24T00:00:00Z" },
  ]);
});

it("a transient local read failure still marks the whole attachment pass ready", async () => {
  mocks.read.mockRejectedValue(
    new Error("temporarily unavailable source volume")
  );
  const ready = await syncSessionSharedFiles({
    token: "fixture",
    endpoint: {
      supabaseUrl: "https://example.test",
      anonKey: "fixture",
      webOrigin: "",
      isOfficial: false,
    },
    orgId: "org",
    sessionId: "session",
    events: [event()],
    assertCurrentIdentity: () => {},
  });
  expect(ready).toBe(true);
  expect(mocks.upload).not.toHaveBeenCalled();
});
