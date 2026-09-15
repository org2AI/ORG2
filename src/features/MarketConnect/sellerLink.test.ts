import { beforeEach, expect, it, vi } from "vitest";

import { closeSeller, handleSellerLink, sellerSnapshot } from "./sellerLink";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.open }));
vi.mock("@src/api/tauri/rpc/invoke", async (original) => ({
  ...(await original<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: mocks.invoke,
}));
const link = "orgii://market/seller/connect?provider=claude&region=sjc";
const callback = "orgii://market/seller/authorized?code=fixture&state=fixture";
const approval =
  "https://market.org2.dev/seller/accounts/authorize?state=fixture";
beforeEach(async () => {
  await closeSeller();
  vi.clearAllMocks();
  mocks.open.mockResolvedValue(undefined);
});
it("opens ORG2 browser approval without marking the account connected", async () => {
  mocks.invoke.mockResolvedValue(approval);
  handleSellerLink(link, new URL(link));
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledWith(approval));
  expect(sellerSnapshot()).toBe("approval");
});
it("rejects a substituted browser destination", async () => {
  mocks.invoke
    .mockResolvedValueOnce("https://attacker.invalid/")
    .mockResolvedValueOnce(undefined);
  handleSellerLink(link, new URL(link));
  await vi.waitFor(() => expect(sellerSnapshot()).toBe("failed"));
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls[1][0].command).toBe("market_seller_cancel");
});
it("waits for native binding confirmation and suppresses duplicate callbacks", async () => {
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  handleSellerLink(callback, new URL(callback));
  expect(sellerSnapshot()).toBe("connecting");
  handleSellerLink(callback, new URL(callback));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  finish({ binding_id: "binding_test", auth_id: "auth_test" });
  await vi.waitFor(() => expect(sellerSnapshot()).toBe("completed"));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("never turns a failed binding into success", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("failed"));
  handleSellerLink(callback, new URL(callback));
  await vi.waitFor(() => expect(sellerSnapshot()).toBe("failed"));
});
it("retains ownership while cancelling a pending native binding", async () => {
  let fail!: (error: Error) => void;
  mocks.invoke
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    )
    .mockResolvedValueOnce(undefined);
  handleSellerLink(callback, new URL(callback));
  await closeSeller();
  expect(sellerSnapshot()).toBe("cancelling");
  handleSellerLink(link, new URL(link));
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  fail(new Error("cancelled"));
  await vi.waitFor(() => expect(sellerSnapshot()).toBe(null));
});
