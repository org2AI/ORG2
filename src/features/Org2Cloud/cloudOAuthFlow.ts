/** One ephemeral receiver and verifier per sign-in. No credentials enter URLs. */
export interface OAuthEndpoint {
  webOrigin: string;
  supabaseUrl: string;
  anonKey: string;
}
export interface OAuthConfig {
  version: 1;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userEndpoint: string;
  redirectUri: string;
  scopes: string[];
}
export interface OAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  oauthClientId: string;
}
export const OAUTH_TTL_MS = 600_000;
export const OAUTH_CALLBACK_PATH = "/org2-cloud/oauth/callback";
const noncePattern = /^[A-Za-z0-9_-]{43}$/;
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const nonce = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export function validateOAuthConfig(
  value: unknown,
  endpoint: OAuthEndpoint
): OAuthConfig {
  const c = value as OAuthConfig;
  if (
    !c ||
    c.version !== 1 ||
    typeof c.clientId !== "string" ||
    !/^[A-Za-z0-9._~-]{8,256}$/.test(c.clientId) ||
    c.authorizationEndpoint !==
      `${endpoint.supabaseUrl}/auth/v1/oauth/authorize` ||
    c.tokenEndpoint !== `${endpoint.supabaseUrl}/auth/v1/oauth/token` ||
    c.userEndpoint !== `${endpoint.supabaseUrl}/auth/v1/oauth/userinfo` ||
    c.redirectUri !==
      new URL("/auth/desktop/oauth/callback", endpoint.webOrigin).toString() ||
    !Array.isArray(c.scopes) ||
    c.scopes.length !== 2 ||
    !c.scopes.includes("email") ||
    !c.scopes.includes("profile")
  ) {
    throw Error("ORG2 OAuth configuration unavailable");
  }
  return c;
}

async function readOAuthJson(
  response: Response
): Promise<Record<string, unknown>> {
  if (!response.body) throw Error("Empty OAuth response");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw Error("OAuth response too large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Invalid OAuth response");
    return value as Record<string, unknown>;
  } finally {
    reader.releaseLock();
  }
}

interface Dependencies {
  start: () => Promise<number>;
  stop: (port: number) => Promise<void>;
  fetch: typeof fetch;
  endpoint: () => OAuthEndpoint;
  identity: () => string;
  commit: (session: OAuthSession) => boolean;
  watch: (invalidate: () => void) => () => void;
}
interface Attempt {
  endpoint: OAuthEndpoint;
  identity: string;
  controller: AbortController;
  expiresAt: number;
  port?: number;
  state?: string;
  verifier: string;
  config?: OAuthConfig;
  timer?: ReturnType<typeof setTimeout>;
  unwatch?: () => void;
  consumed: boolean;
  onSignedIn?: () => void;
}
export class CloudOAuthFlow {
  private pending?: Attempt;
  constructor(private readonly dependencies: Dependencies) {}
  cancelAuthorization(url: string): void {
    if (new URL(url).searchParams.get("state") === this.pending?.state)
      this.cancel();
  }
  cancel(): void {
    const attempt = this.pending;
    this.pending = undefined;
    if (!attempt) return;
    attempt.controller.abort();
    clearTimeout(attempt.timer);
    attempt.unwatch?.();
    if (attempt.port !== undefined)
      void this.dependencies.stop(attempt.port).catch(() => {});
  }
  private current(a: Attempt): boolean {
    const endpoint = this.dependencies.endpoint();
    return (
      this.pending === a &&
      !a.controller.signal.aborted &&
      Date.now() < a.expiresAt &&
      this.dependencies.identity() === a.identity &&
      endpoint.webOrigin === a.endpoint.webOrigin &&
      endpoint.supabaseUrl === a.endpoint.supabaseUrl &&
      endpoint.anonKey === a.endpoint.anonKey
    );
  }
  async begin(onSignedIn?: () => void): Promise<string> {
    this.cancel();
    const a: Attempt = {
      endpoint: { ...this.dependencies.endpoint() },
      identity: this.dependencies.identity(),
      controller: new AbortController(),
      expiresAt: Date.now() + OAUTH_TTL_MS,
      verifier: nonce(),
      consumed: false,
      onSignedIn,
    };
    this.pending = a;
    a.timer = setTimeout(() => {
      if (this.pending === a) this.cancel();
    }, OAUTH_TTL_MS);
    a.unwatch = this.dependencies.watch(() => {
      if (!this.current(a) && this.pending === a) this.cancel();
    });
    try {
      const response = await this.dependencies.fetch(
        new URL("/api/auth/desktop/config", a.endpoint.webOrigin),
        {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([
            a.controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        }
      );
      if (!response.ok) throw Error("ORG2 OAuth unavailable");
      a.config = validateOAuthConfig(await readOAuthJson(response), a.endpoint);
      if (!this.current(a)) throw Error("ORG2 OAuth cancelled");
      const port = await this.dependencies.start();
      if (!this.current(a)) {
        await this.dependencies.stop(port);
        throw Error("ORG2 OAuth cancelled");
      }
      a.port = port;
      if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw Error("Invalid OAuth receiver");
      a.state = `org2v1.${port}.${nonce()}`;
      const challenge = base64url(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(a.verifier)
          )
        )
      );
      if (!this.current(a)) throw Error("ORG2 OAuth cancelled");
      const url = new URL(a.config.authorizationEndpoint);
      url.search = new URLSearchParams({
        client_id: a.config.clientId,
        redirect_uri: a.config.redirectUri,
        response_type: "code",
        scope: a.config.scopes.join(" "),
        state: a.state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return url.toString();
    } catch (error) {
      if (this.pending === a) this.cancel();
      throw error;
    }
  }
  isCallback(raw: string): boolean {
    try {
      const u = new URL(raw);
      return (
        u.protocol === "http:" &&
        u.hostname === "127.0.0.1" &&
        u.pathname === OAUTH_CALLBACK_PATH
      );
    } catch {
      return false;
    }
  }
  async complete(raw: string): Promise<void> {
    const a = this.pending;
    if (!a || a.consumed || !a.config || !this.current(a)) return;
    const url = new URL(raw),
      p = url.searchParams;
    if (
      !this.isCallback(raw) ||
      url.port !== String(a.port) ||
      url.hash ||
      url.username ||
      url.password ||
      p.get("state") !== a.state
    )
      return;
    a.consumed = true;
    try {
      if (
        [...p.keys()].some(
          (k) =>
            !["code", "state", "error", "error_description"].includes(k) ||
            p.getAll(k).length !== 1
        )
      )
        throw Error("Invalid OAuth callback");
      const code = p.get("code");
      if (
        p.has("error") ||
        !code ||
        code.length > 2048 ||
        [...code].some(
          (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
        ) ||
        !noncePattern.test(a.verifier)
      )
        throw Error("OAuth denied");
      const signal = AbortSignal.any([
        a.controller.signal,
        AbortSignal.timeout(15_000),
      ]);
      const response = await this.dependencies.fetch(a.config.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: a.config.clientId,
          redirect_uri: a.config.redirectUri,
          code,
          code_verifier: a.verifier,
        }),
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok) throw Error("OAuth exchange failed");
      const tokens = await readOAuthJson(response);
      if (
        typeof tokens.access_token !== "string" ||
        !tokens.access_token ||
        tokens.access_token.length > 8192 ||
        typeof tokens.refresh_token !== "string" ||
        !tokens.refresh_token ||
        tokens.refresh_token.length > 4096 ||
        typeof tokens.expires_in !== "number" ||
        !Number.isFinite(tokens.expires_in) ||
        tokens.expires_in <= 0 ||
        tokens.expires_in > 86400
      )
        throw Error("Invalid OAuth session");
      if (!this.current(a)) return;
      const userResponse = await this.dependencies.fetch(
        a.config.userEndpoint,
        {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          cache: "no-store",
          redirect: "error",
          signal,
        }
      );
      if (!userResponse.ok) throw Error("OAuth identity rejected");
      const user = await readOAuthJson(userResponse);
      // Verify the token's subject against the server-validated identity before commit.
      const segment = tokens.access_token.split(".")[1];
      const claims = JSON.parse(
        atob(segment.replace(/-/g, "+").replace(/_/g, "/"))
      );
      if (typeof user.sub !== "string" || !user.sub || claims.sub !== user.sub)
        throw Error("OAuth identity mismatch");
      if (!this.current(a)) return;
      const continuation = a.onSignedIn;
      this.cancel();
      if (
        this.dependencies.commit({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
          oauthClientId: a.config.clientId,
        })
      )
        continuation?.();
    } finally {
      if (this.pending === a) this.cancel();
    }
  }
}
