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
    expect(mocks.enqueue).toHaveBeenCalledWith({
      identity: "https://cloud.example|author",
      orgId: "org",
      sessionId: "root",
      candidates: expect.arrayContaining([
        { path: "/workspace/report.pdf", revision: "answer:now" },
        { path: "/tmp/script-output.csv", revision: "answer:now" },
      ]),
    });
    expect(JSON.stringify(mocks.enqueue.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(events)).toBe(before);
    expect(store.get(conversationFileOutboxSignalAtom)).toBe(1);
    expect(mocks.emit).toHaveBeenCalledOnce();
  });
  it("batches all files without imposing a total file count cap", async () => {
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
    ).toEqual([256, 44]);
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
