// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import type { TeamInboxDataSource } from "../domain";
import { useTeamInboxPagination } from "../useTeamInboxPagination";

let root: SmokeRoot;
afterEach(async () => {
  await root?.unmount();
});

it("keeps a mutation failure through subscribed page reloads until explicit refresh or scope switch", async () => {
  root = createSmokeRoot();
  let latest: ReturnType<typeof useTeamInboxPagination>;
  let notify: (() => void) | undefined;
  const source: TeamInboxDataSource = {
    scopeKey: "viewer-a",
    listPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    subscribe: (listener) => {
      notify = listener;
      return () => {
        notify = undefined;
      };
    },
  };
  const t = (key: string) => key;
  const issueMessage = () => "issue";
  function Harness({ dataSource }: { dataSource: TeamInboxDataSource }) {
    const state = useTeamInboxPagination({
      dataSource,
      listMode: "active",
      pageSize: 50,
      t,
      issueMessage,
    });
    useEffect(() => {
      latest = state;
    }, [state]);
    return null;
  }
  await root.render(createElement(Harness, { dataSource: source }));
  const error = { status: "error" as const, message: "Could not mark unread" };
  await act(async () => {
    latest.setLoadState(error);
    notify?.();
  });
  expect(latest!.loadState).toEqual(error);
  await act(async () => {
    notify?.();
  });
  expect(latest!.loadState).toEqual(error);
  await act(async () => {
    latest.handleRefresh();
  });
  expect(latest!.loadState.status).toBe("ready");
  await act(async () => {
    latest.setLoadState(error);
  });
  const oldReport = latest!.setLoadState;
  await root.render(
    createElement(Harness, { dataSource: { ...source, scopeKey: "viewer-b" } })
  );
  expect(latest!.loadState.status).toBe("ready");
  await act(async () => {
    latest.setLoadState(error);
  });
  await act(async () => {
    oldReport({ status: "ready", message: null });
  });
  expect(latest!.loadState).toEqual(error);
  await act(async () => {
    latest.setLoadState({ status: "ready", message: null });
  });
  expect(latest!.loadState.status).toBe("ready");
});
