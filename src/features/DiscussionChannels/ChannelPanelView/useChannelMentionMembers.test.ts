// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { CloudChannel } from "@src/features/Org2Cloud/channels/types";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { useChannelMentionMembers } from "./useChannelMentionMembers";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  token: vi.fn(async () => "token"),
  roster: { members: [{ userId: "org-member" }], loading: false, error: false },
}));
vi.mock("@src/features/Org2Cloud/channels/channelsClient", () => ({
  listCloudChannelMembers: mocks.list,
}));
vi.mock(
  "@src/features/Org2Cloud/channels/components/useChannelDialogAccess",
  () => ({
    useFreshChannelAccessToken: () => mocks.token,
    useActiveOrgMembers: () => mocks.roster,
  })
);
const auth = {
  kind: "org2_cloud" as const,
  supabaseUrl: "https://cloud.example.test",
  supabaseAnonKey: "anon",
  userId: "a",
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: 4102444800,
};
const channel: CloudChannel = {
  id: "private-a",
  name: "Private",
  visibility: "private",
  postPolicy: "everyone",
  createdAt: "2026-09-24",
  archivedAt: null,
  messageCount: 0,
  memberCount: 1,
  myRole: "member",
};

it("discards late private roster responses on identity change, aborts on close, and fails closed", async () => {
  let finish!: (rows: { userId: string }[]) => void;
  mocks.list.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const store = createStore();
  store.set(org2CloudAuthAtom, auth);
  const container = document.createElement("div");
  const root = createRoot(container);
  let result: ReturnType<typeof useChannelMentionMembers>;
  function Probe({
    enabled,
    value,
  }: {
    enabled: boolean;
    value: CloudChannel;
  }) {
    const members = useChannelMentionMembers("org", value, enabled);
    useEffect(() => {
      result = members;
    });
    return null;
  }
  const render = async (enabled = true, value = channel) => {
    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Probe, { enabled, value })
        )
      );
    });
  };
  try {
    await render();
    expect(result!).toBeNull();
    const signal = mocks.list.mock.calls[0][3] as AbortSignal;
    mocks.list.mockRejectedValueOnce(new Error("roster unavailable"));
    await act(async () => {
      store.set(org2CloudAuthAtom, { ...auth, userId: "b" });
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish([{ userId: "private-a-only" }]);
    });
    expect(result!).toBeNull();
    await render(false);
    expect(result!).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await render(true, { ...channel, visibility: "org" });
    expect(result!).toEqual([{ userId: "org-member" }]);
    mocks.roster.error = true;
    await render(true, { ...channel, visibility: "org" });
    expect(result!).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    mocks.roster.error = false;
  }
});
