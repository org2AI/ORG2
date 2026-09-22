import { beforeEach, expect, it, vi } from "vitest";

import { useMarketCloudOwnerRefresh } from "../useMarketCloudOwnerRefresh";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  recovery: vi.fn(),
  listen: vi.fn(),
  handle: vi.fn(),
  isTauri: vi.fn(),
  isMain: vi.fn(),
  store: {},
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));
vi.mock("react", () => ({ useEffect: (effect: () => unknown) => effect() }));
vi.mock("jotai", () => ({ useStore: () => mocks.store }));
vi.mock("@src/features/MarketConnect/ownerRefresh", () => ({
  handleMarketOwnerRefresh: mocks.handle,
  installMarketOwnerRecovery: mocks.recovery,
}));
vi.mock("@src/hooks/platform/useTauriListen", () => ({
  useTauriListen: mocks.listen,
}));
vi.mock("@src/util/platform/tauri/windowIdentity", () => ({
  isMainAppWindow: mocks.isMain,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.isMain.mockReturnValue(true);
  mocks.handle.mockResolvedValue(undefined);
});
it("installs one main-window demand listener and recovers an early ticket once after ready", async () => {
  mocks.invoke.mockResolvedValue("native-ticket");
  useMarketCloudOwnerRefresh();
  expect(mocks.listen).toHaveBeenCalledOnce();
  expect(mocks.recovery).toHaveBeenCalledExactlyOnceWith(mocks.store);
  const [event, handler, options] = mocks.listen.mock.calls[0];
  expect(event).toBe("market-cloud-owner-refresh-needed");
  expect(options.enabled).toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalled();
  options.onReady();
  await vi.waitFor(() =>
    expect(mocks.handle).toHaveBeenCalledWith("native-ticket", mocks.store)
  );
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
    "market_connection_refresh_pending"
  );
  handler("later-ticket");
  expect(mocks.handle).toHaveBeenLastCalledWith("later-ticket", mocks.store);
});
it("does not subscribe another window or a browser-only surface", () => {
  mocks.isMain.mockReturnValue(false);
  useMarketCloudOwnerRefresh();
  expect(mocks.listen.mock.calls[0][2].enabled).toBe(false);
  mocks.isMain.mockReturnValue(true);
  mocks.isTauri.mockReturnValue(false);
  useMarketCloudOwnerRefresh();
  expect(mocks.listen.mock.calls[1][2].enabled).toBe(false);
  expect(mocks.recovery).not.toHaveBeenCalled();
});
