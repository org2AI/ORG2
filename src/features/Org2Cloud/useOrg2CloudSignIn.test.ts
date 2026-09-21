import { describe, expect, it, vi } from "vitest";

import { openOrg2CloudSignIn } from "./useOrg2CloudSignIn";

describe("openOrg2CloudSignIn", () => {
  it("preserves self-hosted login without requiring OAuth server configuration", async () => {
    const callback =
      "http://localhost:49152/org2-cloud/auth/callback?state=06a011d0-3c35-4f81-90cf-468eddd89631";
    const beginAuthLoopback = vi.fn();
    const openExternalUrl = vi.fn(async (_url: string) => undefined);
    await openOrg2CloudSignIn({
      isOfficial: false,
      beginLegacyLoopback: async () => callback,
      beginAuthLoopback,
      openExternalUrl,
    });
    expect(beginAuthLoopback).not.toHaveBeenCalled();
    const url = new URL(openExternalUrl.mock.calls[0][0]);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("return_to")).toBe(callback);
  });

  it("cancels the self-hosted receiver when opening the browser fails", async () => {
    const cancelLegacyLoopback = vi.fn(async () => undefined);
    await expect(
      openOrg2CloudSignIn({
        isOfficial: false,
        beginLegacyLoopback: async () => "http://localhost:49152/callback",
        cancelLegacyLoopback,
        openExternalUrl: async () => {
          throw Error("browser unavailable");
        },
      })
    ).rejects.toThrow("browser unavailable");
    expect(cancelLegacyLoopback).toHaveBeenCalledOnce();
  });

  it("opens the PKCE authorization URL produced by the controller", async () => {
    const callbackUrl =
      "http://localhost:49152/org2-cloud/auth/callback?state=06a011d0-3c35-4f81-90cf-468eddd89631";
    const beginAuthLoopback = vi.fn(async () => callbackUrl);
    const openExternalUrl = vi.fn(async (_url: string) => undefined);

    await openOrg2CloudSignIn({ beginAuthLoopback, openExternalUrl });

    expect(beginAuthLoopback).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    expect(openExternalUrl.mock.calls[0][0]).toBe(callbackUrl);
  });

  it("cancels the pending receiver when the browser cannot be opened", async () => {
    const cancelAuthLoopback = vi.fn(async () => undefined);
    const openError = new Error("browser unavailable");

    await expect(
      openOrg2CloudSignIn({
        beginAuthLoopback: async () =>
          "http://localhost:49152/org2-cloud/auth/callback?state=06a011d0-3c35-4f81-90cf-468eddd89631",
        cancelAuthLoopback,
        openExternalUrl: async () => {
          throw openError;
        },
      })
    ).rejects.toBe(openError);
    expect(cancelAuthLoopback).toHaveBeenCalledTimes(1);
  });
});
