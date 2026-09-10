import { afterEach, describe, expect, it, vi } from "vitest";

import { BROWSER_CACHE_STORAGE_KEYS } from "@src/util/core/storage/quotaRecovery";

import {
  GITHUB_ISSUES_PERSISTED_BUDGET_BYTES,
  GITHUB_LIST_CACHE_TTL_MS,
  coalesceGitHubListRequest,
  flushGitHubListCachePersistence,
  getCachedIssues,
  getCachedPrDetail,
  getCachedPrs,
  isIssueCacheStale,
  isPrCacheStale,
  isPrDetailStale,
  setCachedPrDetail,
  setCachedPrs,
  updateCachedClosedIssues,
  updateCachedOpenIssues,
  updateCachedPrDetail,
} from "./githubListCache";

describe("global GitHub list cache", () => {
  afterEach(() => {
    flushGitHubListCachePersistence();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("coalesces bursty list persistence into one storage write", () => {
    vi.useFakeTimers();
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    });
    const repoKey = `persist-${crypto.randomUUID()}`;

    updateCachedOpenIssues(repoKey, []);
    updateCachedClosedIssues(repoKey, []);
    updateCachedOpenIssues(repoKey, []);

    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("keeps the persisted issue snapshot within its byte budget", () => {
    vi.useFakeTimers();
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    });
    const largeIssues = Array.from({ length: 200 }, (_, index) => ({
      number: index + 1,
      title: `Issue ${index}`,
      body: "x".repeat(8_000),
      state: "open",
    }));

    for (let repoIndex = 0; repoIndex < 4; repoIndex += 1) {
      updateCachedOpenIssues(
        `large-persist-${repoIndex}-${crypto.randomUUID()}`,
        largeIssues as never
      );
    }
    vi.advanceTimersByTime(100);

    const persistedCall = setItem.mock.calls.find(
      ([key]) => key === BROWSER_CACHE_STORAGE_KEYS.githubIssues
    );
    expect(persistedCall).toBeDefined();
    const serialized = String(persistedCall?.[1] ?? "");
    expect(serialized.length * 2).toBeLessThanOrEqual(
      GITHUB_ISSUES_PERSISTED_BUDGET_BYTES
    );
  });

  it("keeps list entries fresh for ten minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T06:00:00.000Z"));
    const repoKey = `ttl-${crypto.randomUUID()}`;

    setCachedPrs(repoKey, []);
    expect(isPrCacheStale(repoKey)).toBe(false);

    vi.advanceTimersByTime(GITHUB_LIST_CACHE_TTL_MS + 1);
    expect(isPrCacheStale(repoKey)).toBe(true);
  });

  it("keeps open and closed PR lists independently lazy", () => {
    const repoKey = `states-${crypto.randomUUID()}`;

    setCachedPrs(repoKey, [], "open");

    expect(getCachedPrs(repoKey, "open")).not.toBeNull();
    expect(getCachedPrs(repoKey, "closed")).toBeNull();
    expect(isPrCacheStale(repoKey, "closed")).toBe(true);
  });

  it("tracks issue freshness independently for open and closed lists", () => {
    const repoKey = `issue-states-${crypto.randomUUID()}`;

    updateCachedOpenIssues(repoKey, []);
    expect(isIssueCacheStale(repoKey, "open")).toBe(false);
    expect(isIssueCacheStale(repoKey, "closed")).toBe(true);

    updateCachedClosedIssues(repoKey, []);
    expect(isIssueCacheStale(repoKey, "closed")).toBe(false);
  });

  it("coalesces in-flight requests and releases them after settlement", async () => {
    const requestFactory = vi.fn(async () => ["loaded"]);
    const key = `request-${crypto.randomUUID()}`;

    const first = coalesceGitHubListRequest(key, requestFactory);
    const second = coalesceGitHubListRequest(key, requestFactory);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(["loaded"]);
    expect(requestFactory).toHaveBeenCalledTimes(1);

    await coalesceGitHubListRequest(key, requestFactory);
    expect(requestFactory).toHaveBeenCalledTimes(2);
  });

  it("patches PR detail mutations without extending unrelated freshness", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T18:00:00.000Z"));
    const key = `detail-${crypto.randomUUID()}`;
    const comment = {
      id: 42,
      body: "session reference",
      user: { login: "reviewer", avatar_url: "" },
      created_at: "2026-07-28T18:09:00.000Z",
      updated_at: "2026-07-28T18:09:00.000Z",
      html_url: "https://github.com/org/repo/pull/1#issuecomment-42",
    };

    setCachedPrDetail(key, {
      detail: null,
      headSha: "head",
      baseRef: "develop",
      conversation: [],
      reviews: [],
      reviewComments: [],
      commits: [],
      files: [],
      checks: null,
    });
    vi.advanceTimersByTime(GITHUB_LIST_CACHE_TTL_MS - 60_000);

    expect(
      updateCachedPrDetail(key, (cached) => ({
        conversation: [...cached.conversation, comment],
      }))
    ).toBe(true);
    expect(getCachedPrDetail(key)?.conversation).toEqual([comment]);

    vi.advanceTimersByTime(60_001);
    expect(isPrDetailStale(key)).toBe(true);
  });

  it("holds four repos of issues and evicts the least-recently-read one", () => {
    const keys = Array.from(
      { length: 5 },
      (_, index) => `issue-cap-${index}-${crypto.randomUUID()}`
    );
    const [first, second, third, fourth, fifth] = keys;

    for (const key of [first, second, third, fourth]) {
      updateCachedOpenIssues(key, []);
    }
    expect(getCachedIssues(fifth)).toBeNull();

    // Reading `first` promotes it, so `second` becomes the eviction victim.
    expect(getCachedIssues(first)).not.toBeNull();
    // A staleness probe must not rescue `second` from eviction.
    expect(isIssueCacheStale(second)).toBe(false);
    updateCachedOpenIssues(fifth, []);

    expect(getCachedIssues(second)).toBeNull();
    expect(isIssueCacheStale(second)).toBe(true);
    for (const key of [first, third, fourth, fifth]) {
      expect(getCachedIssues(key)).not.toBeNull();
    }
  });

  it("holds eight PR lists across repo/state combinations", () => {
    const repoKeys = Array.from(
      { length: 5 },
      (_, index) => `pr-cap-${index}-${crypto.randomUUID()}`
    );

    for (const repoKey of repoKeys.slice(0, 4)) {
      setCachedPrs(repoKey, [], "open");
      setCachedPrs(repoKey, [], "closed");
    }
    for (const repoKey of repoKeys.slice(0, 4)) {
      expect(getCachedPrs(repoKey, "open")).not.toBeNull();
      expect(getCachedPrs(repoKey, "closed")).not.toBeNull();
    }

    setCachedPrs(repoKeys[4], [], "open");

    expect(getCachedPrs(repoKeys[0], "open")).toBeNull();
    expect(getCachedPrs(repoKeys[0], "closed")).not.toBeNull();
    expect(getCachedPrs(repoKeys[4], "open")).not.toBeNull();
  });

  it("holds four PR detail snapshots and keeps in-place patches from growing the cache", () => {
    const detail = {
      detail: null,
      headSha: "head",
      baseRef: "develop",
      conversation: [],
      reviews: [],
      reviewComments: [],
      commits: [],
      files: [],
      checks: null,
    };
    const keys = Array.from(
      { length: 5 },
      (_, index) => `detail-cap-${index}-${crypto.randomUUID()}`
    );

    for (const key of keys.slice(0, 4)) {
      setCachedPrDetail(key, detail);
    }
    expect(updateCachedPrDetail(keys[0], () => ({ headSha: "patched" }))).toBe(
      true
    );
    expect(updateCachedPrDetail(keys[4], () => ({}))).toBe(false);

    setCachedPrDetail(keys[4], detail);

    expect(getCachedPrDetail(keys[1])).toBeNull();
    expect(getCachedPrDetail(keys[0])?.headSha).toBe("patched");
    for (const key of [keys[0], keys[2], keys[3], keys[4]]) {
      expect(getCachedPrDetail(key)).not.toBeNull();
    }
  });
});
