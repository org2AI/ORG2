// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { USER_A, USER_B, authFor, signedInStore } from "./identity.test-utils";
import {
  cancelSellerShortcut,
  confirmSellerShortcut,
  parseSellerShortcut,
  requestSellerShortcut,
  sellerPromptAtom,
} from "./sellerShortcut";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), signIn: vi.fn() }));
vi.mock("@src/components/Message", () => ({ default: { error: vi.fn() } }));
vi.mock("@src/i18n", () => ({ default: { t: (s: string) => s } }));
vi.mock("./sellerAuthorization", () => ({
  connectSellerAccount: mocks.connect,
}));
vi.mock("@src/features/Org2Cloud/useOrg2CloudSignIn", () => ({
  openOrg2CloudSignIn: mocks.signIn,
}));
const link = "orgii://market/seller/connect?provider=claude&region=sjc";
let store: ReturnType<typeof signedInStore>;
beforeEach(() => {
  vi.clearAllMocks();
  store = signedInStore();
  store.set(org2CloudAuthAtom, {
    ...authFor(),
    profile: {
      displayName: "App account",
      primaryEmail: "account@example.test",
    },
  });
  mocks.connect.mockResolvedValue({ binding_id: "binding", auth_id: "auth" });
});
afterEach(() => cancelSellerShortcut(store));
it("admits only the bounded provider and selected region, with no duplicated or extra fields", () => {
  expect(parseSellerShortcut(link)).toEqual({
    provider: "claude",
    region: "sjc",
  });
  expect(
    parseSellerShortcut(link.replace("claude", "codex").replace("sjc", "fra"))
  ).toEqual({ provider: "codex", region: "fra" });
  for (const raw of [
    link + "&provider=codex",
    link + "&region=fra",
    link + "&extra=1",
    link + "#x",
    link.replace("claude", "other"),
    link.replace("sjc", "../x"),
    link.replace("sjc", "-sjc"),
    link.replace("region=sjc", "provider=codex"),
    link.replace("orgii://", "https://"),
    link.replace("market/", "user@market/"),
    link.replace("market/", "market:9/"),
    link.replace("/connect?", "/authorized?"),
  ])
    expect(parseSellerShortcut(raw)).toBeNull();
});
it("shows the current App identity and waits for explicit confirmation", async () => {
  await requestSellerShortcut(link, store);
  expect(store.get(sellerPromptAtom)).toMatchObject({
    identityUserId: USER_A,
    accountLabel: "account@example.test",
    phase: "confirm",
  });
  expect(mocks.connect).not.toHaveBeenCalled();
  await confirmSellerShortcut(store);
  expect(mocks.connect).toHaveBeenCalledWith(
    "claude",
    expect.any(AbortSignal),
    store,
    "sjc"
  );
  expect(store.get(sellerPromptAtom)?.phase).toBe("connected");
});
it("passes a non-default region unchanged and ignores replacement shortcuts", async () => {
  await requestSellerShortcut(link.replace("sjc", "fra"), store);
  await requestSellerShortcut(link.replace("claude", "codex"), store);
  await confirmSellerShortcut(store);
  expect(mocks.connect).toHaveBeenCalledWith(
    "claude",
    expect.any(AbortSignal),
    store,
    "fra"
  );
});
it("cancel before confirmation cannot start supply", async () => {
  await requestSellerShortcut(link, store);
  cancelSellerShortcut(store);
  await confirmSellerShortcut(store);
  expect(store.get(sellerPromptAtom)).toBeNull();
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("owner change cancels consent rather than silently selling under another identity", async () => {
  await requestSellerShortcut(link, store);
  store.set(org2CloudAuthAtom, authFor(USER_B));
  await confirmSellerShortcut(store);
  expect(store.get(sellerPromptAtom)).toBeNull();
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("cancel and owner changes abort in-flight work and suppress its late result", async () => {
  for (const change of [
    () => cancelSellerShortcut(store),
    () => store.set(org2CloudAuthAtom, authFor(USER_B)),
  ]) {
    store.set(org2CloudAuthAtom, authFor());
    let finish!: () => void;
    mocks.connect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await requestSellerShortcut(link, store);
    const pending = confirmSellerShortcut(store);
    const signal = mocks.connect.mock.calls.at(-1)![1] as AbortSignal;
    change();
    expect(signal.aborted).toBe(true);
    finish();
    await pending;
    expect(store.get(sellerPromptAtom)).toBeNull();
  }
});
it("sign-in returns to consent without automatically starting provider work", async () => {
  store.set(org2CloudAuthAtom, null);
  mocks.signIn.mockImplementation(
    async ({ onSignedIn }: { onSignedIn: () => void }) => {
      store.set(org2CloudAuthAtom, authFor());
      onSignedIn();
    }
  );
  await requestSellerShortcut(link, store);
  expect(store.get(sellerPromptAtom)?.phase).toBe("confirm");
  expect(mocks.connect).not.toHaveBeenCalled();
});
