// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { handleMarketConnectionUrl } from "./deepLink";
import { USER_A, USER_B, authFor, signedInStore } from "./identity.test-utils";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("./rpc", () => ({ loadConnections: mocks.load }));
vi.mock("./events", () => ({
  MARKET_CONNECTION_OPEN_EVENT: "open",
  dispatchMarketConnection: mocks.open,
  dispatchMarketConnectionError: mocks.error,
}));
vi.mock("@src/features/Org2Cloud/useOrg2CloudSignIn", () => ({
  openOrg2CloudSignIn: mocks.signIn,
}));
vi.mock("@src/components/Message", () => ({ default: { error: vi.fn() } }));
vi.mock("@src/i18n", () => ({ default: { t: (s: string) => s } }));
const link = "orgii://market/connect?workspace_id=ws_account&target=org2";
const connection = {
  identity_user_id: USER_A,
  workspace_id: "ws_account_owned",
  target: "org2",
  phase: "authorization_saved",
};
beforeEach(() => {
  vi.clearAllMocks();
  signedInStore();
  mocks.load.mockResolvedValue({ connections: [connection] });
});
it("opens the same account catalog used without a website link", async () => {
  expect(handleMarketConnectionUrl(link)).toBe(true);
  await vi.waitFor(() =>
    expect(mocks.open).toHaveBeenCalledWith("open", connection)
  );
  expect(mocks.signIn).not.toHaveBeenCalled();
});
it("retired seller and authorization links cannot authorize or enroll", () => {
  for (const raw of [
    "orgii://market/seller/connect?provider=claude&region=sjc",
    "orgii://market/authorized?code=secret&state=secret",
  ]) {
    expect(handleMarketConnectionUrl(raw)).toBe(true);
  }
  expect(mocks.signIn).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});
it("rejects untrusted and malformed navigation", () => {
  expect(handleMarketConnectionUrl("https://market.org2.dev/connect")).toBe(
    false
  );
  for (const raw of [
    link + "&command=sh",
    link + "#secret",
    link.replace("ws_account", "../x"),
  ])
    handleMarketConnectionUrl(raw);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("suppresses duplicate navigation and discards a result after account switching", async () => {
  const store = signedInStore();
  let finish!: (v: unknown) => void;
  mocks.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  handleMarketConnectionUrl(link);
  handleMarketConnectionUrl(link);
  expect(mocks.load).toHaveBeenCalledTimes(1);
  store.set(org2CloudAuthAtom, authFor(USER_B));
  finish({ connections: [connection] });
  await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.open).not.toHaveBeenCalled();
});
it("signs in normally then resumes navigation", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, null);
  mocks.signIn.mockImplementationOnce(
    async ({ onSignedIn }: { onSignedIn: () => void }) => {
      store.set(org2CloudAuthAtom, authFor());
      onSignedIn();
    }
  );
  handleMarketConnectionUrl(link);
  await vi.waitFor(() =>
    expect(mocks.open).toHaveBeenCalledWith("open", connection)
  );
  expect(mocks.signIn).toHaveBeenCalledTimes(1);
});

it("upgrades a legacy signed-in session through PKCE when Market requires authorization", async () => {
  const store = signedInStore();
  mocks.load.mockRejectedValueOnce(Error("market_reauthorization_required"));
  mocks.signIn.mockImplementationOnce(
    async ({ onSignedIn }: { onSignedIn: () => void }) => {
      store.set(org2CloudAuthAtom, { ...authFor(), oauthClientId: USER_A });
      onSignedIn();
    }
  );
  handleMarketConnectionUrl(link);
  await vi.waitFor(() =>
    expect(mocks.open).toHaveBeenCalledWith("open", connection)
  );
  expect(mocks.signIn).toHaveBeenCalledTimes(1);
  expect(mocks.load).toHaveBeenCalledTimes(2);
});

it("does not start login for a legacy user's network failure", async () => {
  mocks.load.mockRejectedValueOnce(Error("market_request_failed"));
  handleMarketConnectionUrl(link);
  await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.signIn).not.toHaveBeenCalled();
});
