import { invoke } from "@tauri-apps/api/core";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxMessage } from "@src/api/types/inbox";

import { upsertInboxMessageAtom } from "../inboxAtom";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: logError }),
}));

const message: InboxMessage = {
  id: "assignment-1",
  title: "Assigned to you",
  preview: "Work item changed",
  content: "Assignment details",
  category: "workitems",
  priority: "medium",
  status: "unread",
  createdAt: "2026-09-22T00:00:00Z",
  updatedAt: "2026-09-22T00:00:00Z",
  sender: { name: "Member" },
  metadata: { workItemId: "work-1" },
  labels: [{ id: "label-1", name: "Bug", color: "red" }],
};

describe("inbox persistence writer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("persists each update without loading or rewriting message status", async () => {
    const store = createStore();
    await store.set(upsertInboxMessageAtom, message);
    await store.set(upsertInboxMessageAtom, { ...message, title: "Updated" });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, "inbox_upsert", {
      message: {
        id: message.id,
        title: message.title,
        preview: message.preview,
        content: message.content,
        category: message.category,
        priority: message.priority,
        status: message.status,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        senderName: "Member",
        metadata: JSON.stringify(message.metadata),
        labels: JSON.stringify(message.labels),
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "inbox_upsert", {
      message: expect.objectContaining({ id: message.id, title: "Updated" }),
    });
  });

  it("serializes absent optional fields for the existing database command", async () => {
    await createStore().set(upsertInboxMessageAtom, {
      ...message,
      sender: undefined,
      metadata: undefined,
      labels: undefined,
    });
    expect(invoke).toHaveBeenCalledWith("inbox_upsert", {
      message: expect.objectContaining({
        senderName: null,
        metadata: "{}",
        labels: "[]",
      }),
    });
  });

  it("reports failed writes without adding a retry or a read request", async () => {
    const error = new Error("database unavailable");
    vi.mocked(invoke).mockRejectedValueOnce(error);
    await createStore().set(upsertInboxMessageAtom, message);
    expect(logError).toHaveBeenCalledWith("[inbox] Failed to upsert:", error);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
