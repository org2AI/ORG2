// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserMobileAuthClient } from "../platform/browser/browserMobileAuthClient";
import { createSupabaseMobileAuthClient } from "../platform/supabaseMobileAuthClient";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

describe("mobileAuthClient", () => {
  const fetcher = vi.fn() as unknown as typeof fetch;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    vi.mocked(fetcher).mockReset();
    mocks.createClient.mockReturnValue({ auth: mocks });
  });

  it("persists the PKCE verifier and uses the desktop GitHub scopes", async () => {
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: "https://github.example/oauth" },
      error: null,
    });
    const client = createBrowserMobileAuthClient({
      oauthStorage: sessionStorage,
      fetcher,
    });
    await expect(
      client.buildLoginUrl("https://mobile.example/orgii/mobile/auth/callback")
    ).resolves.toBe("https://github.example/oauth");
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: "https://mobile.example/orgii/mobile/auth/callback",
        skipBrowserRedirect: true,
        scopes: "read:user user:email",
      },
    });
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://fpdyejwbiriliuqqcjoy.supabase.co",
      "sb_publishable_FpHAgMYJFGb20HunqnhciA_-2nt9eYU",
      {
        global: { fetch: expect.any(Function) },
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: true,
          flowType: "pkce",
          storage: sessionStorage,
        },
      }
    );
  });

  it("accepts only a PKCE code and never exchanges tokens from the URL fragment", async () => {
    const client = createBrowserMobileAuthClient({
      oauthStorage: sessionStorage,
      fetcher,
    });
    await expect(
      client.exchangeCallback(
        "https://mobile.example/orgii/mobile/auth/callback#access_token=secret&refresh_token=secret"
      )
    ).rejects.toThrow("callback is incomplete");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("native login opens the shared Cloud page carrying only the public PKCE challenge", async () => {
    const challenge = "a".repeat(43);
    mocks.signInWithOAuth.mockResolvedValue({
      data: {
        url: `https://project.supabase.co/auth/v1/authorize?provider=github&code_challenge=${challenge}&code_challenge_method=s256`,
      },
      error: null,
    });
    const client = createSupabaseMobileAuthClient({
      oauthStorage: sessionStorage,
      fetcher,
      serverSessionUrl: null,
      useCloudLogin: true,
    });
    const url = new URL(
      await client.buildLoginUrl("org2remote://auth/callback")
    );
    expect(url.origin + url.pathname).toBe(
      "https://org2-cloud-infra.vercel.app/login"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      return_to: "org2remote://auth/callback",
      code_challenge: challenge,
      code_challenge_method: "s256",
    });
    await expect(client.buildLoginUrl("https://evil.example")).rejects.toThrow(
      "Invalid native"
    );
    mocks.signInWithOAuth.mockResolvedValue({
      data: {
        url: "https://project.supabase.co/auth/v1/authorize?code_challenge=weak&code_challenge_method=plain",
      },
      error: null,
    });
    await expect(
      client.buildLoginUrl("org2remote://auth/callback")
    ).rejects.toThrow("Secure login preparation failed");
  });
});
