import { createStore } from "jotai";
import { RESET } from "jotai/utils";
import { afterEach, expect, it, vi } from "vitest";

import { SHARED_AUTH_SYNCHRONIZED_EVENT } from "@src/api/http/auth/sharedAuthStorage";

import { refreshOrg2CloudAuthForAction } from "./org2CloudAuthAction";
import {
  ORG2_CLOUD_AUTH_STORAGE_KEY,
  type Org2CloudAuthState,
  clearRejectedAuth,
  commitRefreshedAuth,
  org2CloudAuthAtom,
} from "./org2CloudAuthAtom";

const auth: Org2CloudAuthState = {
  kind: "org2_cloud",
  supabaseUrl: "https://cloud.example.test",
  supabaseAnonKey: "public-key",
  userId: "user-1",
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: 0,
};
const fresh: Org2CloudAuthState = {
  ...auth,
  accessToken: "new-access",
  refreshToken: "new-refresh",
  expiresAt: 1000,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem(ORG2_CLOUD_AUTH_STORAGE_KEY);
});

it.each(["logout", "endpoint switch"])(
  "does not return fresh auth after %s during the action await",
  async (change) => {
    const store = createStore();
    const current = { ...auth, expiresAt: Date.now() / 1000 + 3600 };
    store.set(org2CloudAuthAtom, current);
    const pending = refreshOrg2CloudAuthForAction(current, (update) => {
      store.set(org2CloudAuthAtom, update);
    });
    const switched =
      change === "logout"
        ? null
        : { ...current, supabaseUrl: "https://other.example.test" };
    store.set(org2CloudAuthAtom, switched);
    expect((await pending).status).toBe("superseded");
    expect(store.get(org2CloudAuthAtom)).toBe(switched);
  }
);

it("validates comfortably fresh auth without persisting a no-op", async () => {
  const store = createStore();
  const current = { ...auth, expiresAt: Date.now() / 1000 + 3600 };
  store.set(org2CloudAuthAtom, current);
  const setItem = vi.spyOn(localStorage, "setItem");
  const result = await refreshOrg2CloudAuthForAction(current, (update) => {
    store.set(org2CloudAuthAtom, update);
  });
  expect(result).toEqual({ status: "ready", auth: current });
  expect(setItem).not.toHaveBeenCalled();
  store.set(org2CloudAuthAtom, { ...current });
  expect(setItem).toHaveBeenCalledTimes(1);
});

it("does not persist a functional auth update that returns the current object", () => {
  const store = createStore();
  store.set(org2CloudAuthAtom, auth);
  const setItem = vi.spyOn(localStorage, "setItem");
  store.set(org2CloudAuthAtom, (current) => current);
  expect(setItem).not.toHaveBeenCalled();
});

it("retains atomWithStorage RESET behavior", () => {
  const store = createStore();
  store.set(org2CloudAuthAtom, auth);
  store.set(org2CloudAuthAtom, RESET);
  expect(store.get(org2CloudAuthAtom)).toBeNull();
  expect(localStorage.getItem(ORG2_CLOUD_AUTH_STORAGE_KEY)).toBeNull();
});

it.each([200, 400])(
  "keeps refresh completion valid when shared auth rehydrates the same generation (HTTP %s)",
  async (status) => {
    const events = new EventTarget();
    vi.spyOn(window, "addEventListener").mockImplementation(
      events.addEventListener.bind(events)
    );
    vi.spyOn(window, "removeEventListener").mockImplementation(
      events.removeEventListener.bind(events)
    );
    let respond!: (value: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => (respond = resolve))
    );
    vi.stubGlobal("fetch", fetchMock);
    const store = createStore();
    store.set(org2CloudAuthAtom, auth);
    const unsubscribe = store.sub(org2CloudAuthAtom, () => {});
    try {
      const captured = store.get(org2CloudAuthAtom)!;
      const pending = refreshOrg2CloudAuthForAction(captured, (update) => {
        store.set(org2CloudAuthAtom, update);
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      events.dispatchEvent(new Event(SHARED_AUTH_SYNCHRONIZED_EVENT));
      expect(store.get(org2CloudAuthAtom)).not.toBe(captured);
      expect(store.get(org2CloudAuthAtom)).toEqual(captured);
      respond(
        new Response(
          JSON.stringify({
            access_token: fresh.accessToken,
            refresh_token: fresh.refreshToken,
            expires_at: fresh.expiresAt,
          }),
          { status }
        )
      );
      expect((await pending).status).toBe(status === 200 ? "ready" : "expired");
      const expected = status === 200 ? fresh : null;
      expect(store.get(org2CloudAuthAtom)).toEqual(expected);
      expect(
        JSON.parse(localStorage.getItem(ORG2_CLOUD_AUTH_STORAGE_KEY)!)
      ).toEqual(expected);
    } finally {
      unsubscribe();
    }
  }
);

it.each([
  ["endpoint", { supabaseUrl: "https://other.example.test" }],
  ["user", { userId: "user-2" }],
  ["public key", { supabaseAnonKey: "other-public-key" }],
  ["OAuth client", { oauthClientId: "other-client" }],
  ["access token", { accessToken: "newer-access" }],
  ["refresh token", { refreshToken: "newer-refresh" }],
  ["expiry", { expiresAt: 100 }],
] as const)("cannot commit or clear across changed %s", (_name, change) => {
  const store = createStore();
  const current = { ...auth, ...change };
  store.set(org2CloudAuthAtom, current);
  const setAuth = (
    update: (value: Org2CloudAuthState | null) => Org2CloudAuthState | null
  ) => store.set(org2CloudAuthAtom, update);
  expect(commitRefreshedAuth(setAuth, auth, fresh)).toBe(false);
  expect(clearRejectedAuth(setAuth, auth)).toBe(false);
  expect(store.get(org2CloudAuthAtom)).toBe(current);
});

it("preserves newer profile enrichment while committing only a matching credential generation", () => {
  const store = createStore();
  store.set(org2CloudAuthAtom, {
    ...auth,
    profile: { displayName: "Latest profile" },
  });
  const committed = commitRefreshedAuth(
    (update) => store.set(org2CloudAuthAtom, update),
    auth,
    fresh
  );
  expect(committed).toBe(true);
  expect(store.get(org2CloudAuthAtom)).toEqual({
    ...fresh,
    profile: { displayName: "Latest profile" },
  });
});

it("keeps the fresh object's identity after unchanged profile rehydration for sign-in enrichment", () => {
  const store = createStore();
  const previous = { ...auth, profile: { displayName: "Same profile" } };
  const rotated = { ...fresh, profile: { ...previous.profile } };
  store.set(org2CloudAuthAtom, {
    ...previous,
    profile: { ...previous.profile },
  });
  expect(
    commitRefreshedAuth(
      (update) => store.set(org2CloudAuthAtom, update),
      previous,
      rotated
    )
  ).toBe(true);
  expect(store.get(org2CloudAuthAtom)).toBe(rotated);
});

it("preserves profile supplied by the refreshed state when none was concurrently enriched", () => {
  const store = createStore();
  store.set(org2CloudAuthAtom, { ...auth });
  const enriched = { ...fresh, profile: { displayName: "First profile" } };
  expect(
    commitRefreshedAuth(
      (update) => store.set(org2CloudAuthAtom, update),
      auth,
      enriched
    )
  ).toBe(true);
  expect(store.get(org2CloudAuthAtom)).toBe(enriched);
});
