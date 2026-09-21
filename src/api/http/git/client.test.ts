import { afterEach, describe, expect, it, vi } from "vitest";

import { configureIdeServerToken } from "@src/config/ideServer";

import { fetchRustApi } from "./client";

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ status: 0, data: { ok: true } }), {
        status: 200,
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

describe("fetchRustApi", () => {
  afterEach(() => {
    configureIdeServerToken("");
    vi.unstubAllGlobals();
  });

  it("authenticates every request with the local IDE server token", async () => {
    configureIdeServerToken("launch-token");
    const fetchMock = stubFetch();

    await fetchRustApi("http://localhost:13847/git/api/git/repo/r/status", {
      method: "POST",
      headers: { "X-Caller": "kept" },
    });

    expect(sentHeaders(fetchMock)).toEqual({
      "Content-Type": "application/json",
      "x-orgii-token": "launch-token",
      "X-Caller": "kept",
    });
  });

  it("omits the header when no token is configured", async () => {
    const fetchMock = stubFetch();

    await fetchRustApi("http://localhost:13847/git/api/git/repo/r/status");

    expect(sentHeaders(fetchMock)).toEqual({
      "Content-Type": "application/json",
    });
  });
});
