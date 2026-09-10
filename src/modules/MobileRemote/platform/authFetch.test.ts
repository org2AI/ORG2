import { afterEach, expect, it, vi } from "vitest";

import { createBoundedAuthFetch } from "./authFetch";

afterEach(() => vi.useRealTimers());
it("preserves an auth response and releases its timeout", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ authenticated: true }));
  const response = await createBoundedAuthFetch(fetcher)(
    "https://auth.example"
  );
  expect(await response.json()).toEqual({ authenticated: true });
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds body size and prevents redirecting account credentials", async () => {
  const fetcher = vi.fn(async (_input, init) => {
    expect(init?.redirect).toBe("error");
    return new Response("x".repeat(65 * 1024));
  });
  await expect(
    createBoundedAuthFetch(fetcher)("https://auth.example")
  ).rejects.toThrow("size limit");
});
it("aborts a stalled request and cleans up its timer", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true }
        );
      })
  );
  const operation = createBoundedAuthFetch(fetcher)("https://auth.example");
  const assertion = expect(operation).rejects.toThrow("aborted");
  await vi.advanceTimersByTimeAsync(10_000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
