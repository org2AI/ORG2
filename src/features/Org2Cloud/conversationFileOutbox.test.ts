import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  conversationFileOutboxSignalAtom,
  enqueueConversationSharedFiles,
} from "./conversationFileOutbox";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { cloudFileOutbox: { enqueue: mocks.enqueue } },
}));
const auth = {
  kind: "org2_cloud" as const,
  supabaseUrl: "https://cloud.example",
  supabaseAnonKey: "anon",
  userId: "author",
  accessToken: "secret",
  refreshToken: "refresh",
  expiresAt: 9999999999,
};
function output(text: string, id = "answer"): SessionEvent {
  return {
    id,
    createdAt: "now",
    source: "assistant",
    actionType: "assistant",
    displayStatus: "completed",
    displayVariant: "message",
    displayText: text,
    repoPath: "/workspace",
  } as SessionEvent;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enqueue.mockResolvedValue(undefined);
  mocks.emit.mockResolvedValue(undefined);
});
describe("continuation file producing boundary", () => {
  it("automatically queues answer links including shell output without a write-file event", async () => {
    const store = createStore();
    const events = [
      output("[Report](report.pdf) [file:/tmp/script-output.csv]"),
    ];
    const before = JSON.stringify(events);
    await enqueueConversationSharedFiles({
      store,
      auth,
      orgId: "org",
      sessionId: "root",
      events,
      assertCurrentIdentity: () => {},
    });
    expect(
      mocks.enqueue.mock.calls.map(([input]) => input.candidates).flat()
    ).toEqual(
      expect.arrayContaining([
        { path: "/workspace/report.pdf", revision: "answer:now" },
        { path: "/tmp/script-output.csv", revision: "answer:now" },
      ])
    );
    for (const [input] of mocks.enqueue.mock.calls)
      expect(input).toMatchObject({
        identity: "https://cloud.example|author",
        orgId: "org",
        sessionId: "root",
      });
    expect(JSON.stringify(mocks.enqueue.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(events)).toBe(before);
    expect(store.get(conversationFileOutboxSignalAtom)).toBe(2);
    expect(mocks.emit).toHaveBeenCalledTimes(2);
  });
  it("captures all files individually without imposing a total file count cap", async () => {
    await enqueueConversationSharedFiles({
      store: createStore(),
      auth,
      orgId: "org",
      sessionId: "root",
      events: Array.from({ length: 300 }, (_, i) =>
        output(`[r](/r/${i})`, `e${i}`)
      ),
      assertCurrentIdentity: () => {},
    });
    expect(
      mocks.enqueue.mock.calls.map(([input]) => input.candidates.length)
    ).toEqual(Array(300).fill(1));
  });
  it("stops before capturing another source after identity changes during capture", async () => {
    let current = true;
    mocks.enqueue.mockImplementationOnce(async () => {
      current = false;
    });
    await expect(
      enqueueConversationSharedFiles({
        store: createStore(),
        auth,
        orgId: "org",
        sessionId: "root",
        events: [output("[a](/first) [b](/second)")],
        assertCurrentIdentity: () => {
          if (!current) throw new Error("identity changed");
        },
      })
    ).rejects.toThrow("identity changed");
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("propagates journal errors without falsely signalling successful persistence", async () => {
    const store = createStore();
    mocks.enqueue.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      enqueueConversationSharedFiles({
        store,
        auth,
        orgId: "org",
        sessionId: "root",
        events: [output("[r](/report)")],
        assertCurrentIdentity: () => {},
      })
    ).rejects.toThrow("disk full");
    expect(store.get(conversationFileOutboxSignalAtom)).toBe(0);
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("does no journal IO for a body-only answer", async () => {
    await enqueueConversationSharedFiles({
      store: createStore(),
      auth,
      orgId: "org",
      sessionId: "root",
      events: [output("done")],
      assertCurrentIdentity: () => {},
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
