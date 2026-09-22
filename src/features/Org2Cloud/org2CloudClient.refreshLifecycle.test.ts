import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  ORG2_CLOUD_AUTH_STORAGE_KEY,
  type Org2CloudAuthState,
} from "./org2CloudAuthAtom";
import { ensureFreshSession } from "./org2CloudClient";

const stale: Org2CloudAuthState = {
  kind: "org2_cloud",
  supabaseUrl: "https://cloud.example.test",
  supabaseAnonKey: "public-key",
  userId: "user-1",
  accessToken: "expired-access",
  refreshToken: "test-refresh",
  expiresAt: 0,
};
const fetchMock = vi.fn();

function persist(auth: Org2CloudAuthState | null) {
  localStorage.setItem(ORG2_CLOUD_AUTH_STORAGE_KEY, JSON.stringify(auth));
}

/** Unlike an immediate callback mock, each request waits for the prior owner. */
function serialWebLocks(initial: Promise<unknown> = Promise.resolve()) {
  let queue = initial;
  const request = vi.fn(
    (_name: string, _options: unknown, run: () => Promise<unknown>) => {
      const result = queue.then(run);
      queue = result.catch(() => {});
      return result;
    }
  );
  vi.stubGlobal("navigator", { locks: { request } });
  return request;
}

function freshResponse() {
  return new Response(
    JSON.stringify({
      access_token: "fresh-access",
      refresh_token: "rotated-refresh",
      expires_in: 3600,
    })
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  persist(stale);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem(ORG2_CLOUD_AUTH_STORAGE_KEY);
  fetchMock.mockReset();
});

it("shares a rejected exchange across queued consumers and stops after sign-out", async () => {
  const locks = serialWebLocks();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 400 }));
  const rejected = vi.fn(() => persist(null));
  const outcomes = await Promise.all(
    Array.from({ length: 7 }, () =>
      ensureFreshSession(stale, { onRefreshRejected: rejected })
    )
  );
  expect(outcomes).toEqual(Array(7).fill(null));
  expect(rejected).toHaveBeenCalledTimes(7);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(locks).toHaveBeenCalledTimes(1);
});

it.each([
  ["sign-out", null],
  [
    "account switch",
    { ...stale, userId: "user-2", expiresAt: Date.now() / 1000 + 3600 },
  ],
  ["endpoint switch", { ...stale, supabaseUrl: "https://other.example.test" }],
  [
    "client switch",
    {
      ...stale,
      oauthClientId: "other-client",
      expiresAt: Date.now() / 1000 + 3600,
    },
  ],
  ["newer expired rotation", { ...stale, refreshToken: "newer-refresh" }],
] as const)("discards queued work after %s", async (_name, next) => {
  let unlock!: () => void;
  serialWebLocks(new Promise<void>((resolve) => (unlock = resolve)));
  fetchMock.mockImplementation(async () => freshResponse());
  const rejected = vi.fn();
  const pending = ensureFreshSession(stale, { onRefreshRejected: rejected });
  persist(next);
  unlock();
  expect(await pending).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(rejected).not.toHaveBeenCalled();
});

it("adopts a fresh rotation published by another window while queued", async () => {
  let unlock!: () => void;
  serialWebLocks(new Promise<void>((resolve) => (unlock = resolve)));
  const pending = ensureFreshSession(stale);
  const rotated = {
    ...stale,
    refreshToken: "fresh-rotation",
    accessToken: "fresh-access",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  persist(rotated);
  unlock();
  expect(await pending).toEqual(rotated);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("stops queued work when sign-out removes the storage key", async () => {
  let unlock!: () => void;
  serialWebLocks(new Promise<void>((resolve) => (unlock = resolve)));
  const pending = ensureFreshSession(stale);
  localStorage.removeItem(ORG2_CLOUD_AUTH_STORAGE_KEY);
  unlock();
  expect(await pending).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not mistake a failed locked read for a sign-out", async () => {
  let unlock!: () => void;
  serialWebLocks(new Promise<void>((resolve) => (unlock = resolve)));
  fetchMock.mockResolvedValueOnce(freshResponse());
  const pending = ensureFreshSession(stale);
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  unlock();
  expect((await pending)?.refreshToken).toBe("rotated-refresh");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("shares a successful rotation without replacing each caller's profile", async () => {
  serialWebLocks();
  fetchMock.mockResolvedValueOnce(freshResponse());
  const first = ensureFreshSession(stale);
  const enriched = ensureFreshSession({
    ...stale,
    profile: { displayName: "Latest profile" },
  });
  const [a, b] = await Promise.all([first, enriched]);
  expect(a?.refreshToken).toBe("rotated-refresh");
  expect(b?.refreshToken).toBe("rotated-refresh");
  expect(b?.profile?.displayName).toBe("Latest profile");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["absent", "unreadable", "malformed"])(
  "allows the first exchange with %s local storage",
  async (storage) => {
    serialWebLocks();
    localStorage.removeItem(ORG2_CLOUD_AUTH_STORAGE_KEY);
    if (storage === "unreadable") {
      vi.spyOn(localStorage, "getItem").mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    } else if (storage === "malformed") {
      localStorage.setItem(ORG2_CLOUD_AUTH_STORAGE_KEY, "invalid json");
    }
    fetchMock.mockImplementation(async () => freshResponse());
    expect((await ensureFreshSession(stale))?.refreshToken).toBe(
      "rotated-refresh"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);

it("releases a failed flight so a later explicit action can retry", async () => {
  serialWebLocks();
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
  const rejected = vi.fn();
  expect(
    await ensureFreshSession(stale, { onRefreshRejected: rejected })
  ).toBeNull();
  fetchMock.mockResolvedValueOnce(freshResponse());
  expect((await ensureFreshSession(stale))?.refreshToken).toBe(
    "rotated-refresh"
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(rejected).not.toHaveBeenCalled();
});

it("shares one forced exchange across consumers of the same rejected access token", async () => {
  const locks = serialWebLocks();
  const fresh = { ...stale, expiresAt: Date.now() / 1000 + 3600 };
  persist(fresh);
  fetchMock.mockResolvedValueOnce(freshResponse());
  const results = await Promise.all(
    Array.from({ length: 7 }, () =>
      ensureFreshSession(fresh, { forceRefresh: true })
    )
  );
  expect(
    results.every((result) => result?.accessToken === "fresh-access")
  ).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(locks).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "does not share forced refresh with an adoption flight (first forced: %s)",
  async (firstForced) => {
    let unlock!: () => void;
    serialWebLocks(new Promise<void>((resolve) => (unlock = resolve)));
    // Both callers use the same refresh token. The first can adopt this fresh
    // copy; the second knows these persisted access bytes were rejected.
    const persisted = {
      ...stale,
      accessToken: "server-rejected-access",
      expiresAt: Date.now() / 1000 + 3600,
    };
    persist(persisted);
    fetchMock.mockResolvedValueOnce(freshResponse());
    const first = ensureFreshSession(stale, { forceRefresh: firstForced });
    const second = ensureFreshSession(persisted, { forceRefresh: true });
    unlock();
    expect((await first)?.accessToken).toBe(persisted.accessToken);
    expect((await second)?.accessToken).toBe("fresh-access");
    expect(fetchMock).toHaveBeenCalledOnce();
  }
);

it("uses a same-access rotation published while a forced caller waits", async () => {
  let unlock!: () => void;
  serialWebLocks(new Promise<void>((resolve) => (unlock = resolve)));
  const fresh = { ...stale, expiresAt: Date.now() / 1000 + 3600 };
  persist(fresh);
  fetchMock.mockResolvedValueOnce(freshResponse());
  const pending = ensureFreshSession(fresh, { forceRefresh: true });
  persist({ ...fresh, refreshToken: "latest-refresh" });
  unlock();
  expect((await pending)?.accessToken).toBe("fresh-access");
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toEqual({
    refresh_token: "latest-refresh",
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("does not let forced refresh bypass a queued sign-out", async () => {
  let unlock!: () => void;
  serialWebLocks(new Promise<void>((resolve) => (unlock = resolve)));
  const fresh = { ...stale, expiresAt: Date.now() / 1000 + 3600 };
  persist(fresh);
  const rejected = vi.fn();
  const pending = ensureFreshSession(fresh, {
    forceRefresh: true,
    onRefreshRejected: rejected,
  });
  persist(null);
  unlock();
  expect(await pending).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(rejected).not.toHaveBeenCalled();
});
