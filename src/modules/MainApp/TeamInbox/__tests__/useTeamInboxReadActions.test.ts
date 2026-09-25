// @vitest-environment jsdom
import { StrictMode, act, createElement, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import type { CommentMentionItem, TeamInboxDataSource } from "../domain";
import { useTeamInboxReadActions } from "../useTeamInboxReadActions";

const mention: CommentMentionItem = {
  id: "message-1",
  kind: "comment_mention",
  occurredAt: "2026-09-24T00:00:00Z",
  readAt: null,
  actor: { id: "author", displayName: "Author" },
  target: {
    kind: "channel_message",
    orgId: "org",
    channelId: "channel",
    channelName: "test",
    visibility: "org",
    messageId: "message-1",
  },
  payload: { commentBody: "@Recipient hello", commentCount: 1 },
};

let root: SmokeRoot;
afterEach(async () => {
  await root?.unmount();
});

function harness() {
  root = createSmokeRoot();
  const markRead = vi.fn(async () => {});
  const markUnread = vi.fn(async () => {});
  const refresh = vi.fn(async () => {});
  const setLoadState = vi.fn();
  let actions: ReturnType<typeof useTeamInboxReadActions>;
  const t = (key: string) => key;
  const source: TeamInboxDataSource = {
    scopeKey: "viewer-a",
    listPage: vi.fn(),
    markRead,
    markUnread,
    refresh,
  };
  function Probe({
    item,
    dataSource,
  }: {
    item: CommentMentionItem | null;
    dataSource: TeamInboxDataSource;
  }) {
    const current = useTeamInboxReadActions({
      dataSource,
      t,
      setLoadState,
      selectedItem: item,
      selectedPullRequest: null,
      visibleFilter: "all",
      unreadCounts: { all: 1, mentions: 1, assigned: 0 },
    });
    useEffect(() => {
      actions = current;
    }, [current]);
    return null;
  }
  return {
    markRead,
    markUnread,
    refresh,
    setLoadState,
    render: (item: CommentMentionItem | null, scopeKey = "viewer-a") =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(Probe, { item, dataSource: { ...source, scopeKey } })
        )
      ),
    unread: (item: CommentMentionItem) =>
      act(async () => {
        actions.handleMarkUnread(item);
      }),
  };
}

describe("useTeamInboxReadActions", () => {
  it("marks an opening once and preserves explicit unread across snapshot and callback refreshes", async () => {
    const h = harness();
    await h.render(mention);
    expect(h.markRead).toHaveBeenCalledTimes(1);
    const read = { ...mention, readAt: "2026-09-24T01:00:00Z" };
    await h.render(read);
    await h.unread(read);
    await h.render({ ...mention });
    await h.render({ ...mention });
    expect(h.markUnread).toHaveBeenCalledTimes(1);
    expect(h.markRead).toHaveBeenCalledTimes(1);
  });

  it("reads again only after leaving/reopening or changing viewer scope", async () => {
    const h = harness();
    await h.render(mention);
    await h.render(null);
    await h.render(mention);
    expect(h.markRead).toHaveBeenCalledTimes(2);
    await h.render(mention, "viewer-b");
    expect(h.markRead).toHaveBeenCalledTimes(3);
    await h.render({ ...mention, id: "message-2" }, "viewer-b");
    expect(h.markRead).toHaveBeenCalledTimes(4);
  });

  it("does not repeatedly write on refresh after a failed automatic read", async () => {
    const h = harness();
    h.markRead.mockRejectedValue(new Error("offline"));
    await h.render(mention);
    await h.render({ ...mention });
    expect(h.markRead).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.setLoadState).toHaveBeenCalledWith({
      status: "error",
      message: "teamInbox.errors.markRead",
    });
  });
});
