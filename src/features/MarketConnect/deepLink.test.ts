import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleMarketConnectionUrl } from "./deepLink";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.open }));
vi.mock("@src/components/Message", () => ({
  default: { success: mocks.success, error: mocks.error },
}));
vi.mock("@src/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@src/api/tauri/rpc/invoke", async (original) => ({
  ...(await original<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: mocks.invoke,
}));

const selection = "orgii://market/connect?workspace_id=ws_example&target=codex";
const callback = "orgii://market/authorized?code=fixture&state=fixture";
const approval =
  "https://market.org2.dev/buyer/connect/authorize?state=fixture";
describe("installed ORG2 Market handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(undefined);
  });

  it("leaves unrelated deep links to their existing owner", () => {
    expect(handleMarketConnectionUrl("orgii://cloud/join?invite=x")).toBe(
      false
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("opens the fixed approval destination and never reports connected", async () => {
    mocks.invoke.mockResolvedValue(approval);
    expect(handleMarketConnectionUrl(selection)).toBe(true);
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledWith(approval));
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("cancels enrollment when an unexpected destination is returned", async () => {
    mocks.invoke
      .mockResolvedValueOnce("https://evil.test/authorize")
      .mockResolvedValueOnce(undefined);
    handleMarketConnectionUrl(selection);
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls[1][0].command).toBe(
      "market_connection_cancel"
    );
  });

  it("preserves a callback arriving before the browser-open operation completes", async () => {
    let opened!: () => void;
    mocks.open.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          opened = resolve;
        })
    );
    mocks.invoke.mockResolvedValueOnce(approval).mockResolvedValueOnce({
      identity_user_id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "ws_example",
      target: "codex",
      phase: "authorization_saved",
    });
    handleMarketConnectionUrl(selection);
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
    handleMarketConnectionUrl(callback);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    opened();
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(mocks.invoke.mock.calls[1][0].command).toBe(
      "market_connection_complete"
    );
    expect(mocks.success).toHaveBeenCalledWith(
      "integrations:marketConnection.authorizationSaved"
    );
  });
});

it("reports unsupported buyer credential storage without opening authorization", async () => {
  vi.clearAllMocks();
  mocks.invoke.mockRejectedValueOnce(
    new Error("market_buyer_credential_store_unavailable")
  );
  handleMarketConnectionUrl(selection);
  await vi.waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(
      "integrations:marketConnection.platformUnavailable"
    )
  );
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});
