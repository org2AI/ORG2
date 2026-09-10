import {
  type Session,
  type SupabaseClient,
  type SupportedStorage,
  createClient,
} from "@supabase/supabase-js";

import {
  ORG2_CLOUD_OFFICIAL_ANON_KEY,
  ORG2_CLOUD_OFFICIAL_SUPABASE_URL,
  ORG2_CLOUD_OFFICIAL_WEB_ORIGIN,
} from "@src/features/Org2Cloud/config";

import {
  type MobileAuthClient,
  MobileAuthClientError,
} from "../auth/mobileAuthClient";
import type { MobileAuthSession } from "../auth/mobileAuthState";
import { createBoundedAuthFetch } from "./authFetch";

export const MOBILE_AUTH_SERVER_SESSION_PATH = "/v1/mobile/auth/session";
const EXPIRY_SKEW_SECONDS = 60;

function isPermanentStatus(status: unknown): boolean {
  return status === 400 || status === 401 || status === 403;
}

export function toMobileAuthClientError(error: unknown): MobileAuthClientError {
  if (error instanceof MobileAuthClientError) return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; status?: unknown };
    return new MobileAuthClientError(
      typeof record.message === "string"
        ? record.message
        : "Authentication failed",
      !isPermanentStatus(record.status)
    );
  }
  return new MobileAuthClientError(
    error instanceof Error ? error.message : "Authentication failed"
  );
}

function profileFromSession(
  session: Session,
  previous?: MobileAuthSession["profile"]
): MobileAuthSession["profile"] {
  const metadata = session.user.user_metadata ?? {};
  const displayName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : previous?.displayName;
  const primaryEmail = session.user.email ?? previous?.primaryEmail;
  const avatarUrl =
    typeof metadata.avatar_url === "string"
      ? metadata.avatar_url
      : previous?.avatarUrl;
  return displayName || primaryEmail || avatarUrl
    ? { displayName, primaryEmail, avatarUrl }
    : undefined;
}

function toMobileSession(
  session: Session,
  previous?: MobileAuthSession
): MobileAuthSession {
  const expiresAt = session.expires_at;
  if (!expiresAt || !session.user.id) {
    throw new MobileAuthClientError(
      "Authentication response is incomplete",
      false
    );
  }
  return {
    kind: "org2_cloud",
    supabaseUrl: ORG2_CLOUD_OFFICIAL_SUPABASE_URL,
    supabaseAnonKey: ORG2_CLOUD_OFFICIAL_ANON_KEY,
    userId: session.user.id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt,
    profile: profileFromSession(session, previous?.profile),
  };
}

function createOfficialClient(
  storage: SupportedStorage,
  fetcher: typeof fetch
): SupabaseClient {
  return createClient(
    ORG2_CLOUD_OFFICIAL_SUPABASE_URL,
    ORG2_CLOUD_OFFICIAL_ANON_KEY,
    {
      global: { fetch: fetcher },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        flowType: "pkce",
        storage,
      },
    }
  );
}

export interface SupabaseMobileAuthClientOptions {
  oauthStorage: SupportedStorage;
  fetcher: typeof fetch;
  /** Native shells omit this because they do not own browser cookies. */
  serverSessionUrl?: string | null;
  now?: () => number;
  /** Native clients use the shared Cloud login UI with an app-owned PKCE verifier. */
  useCloudLogin?: boolean;
}

/** Shared PKCE implementation. Shells inject storage/navigation boundaries. */
export function createSupabaseMobileAuthClient({
  oauthStorage,
  fetcher,
  serverSessionUrl = MOBILE_AUTH_SERVER_SESSION_PATH,
  now = Date.now,
  useCloudLogin = false,
}: SupabaseMobileAuthClientOptions): MobileAuthClient {
  const authFetch = createBoundedAuthFetch(fetcher);
  const supabase = createOfficialClient(oauthStorage, authFetch);

  return {
    async buildLoginUrl(callbackUrl) {
      if (useCloudLogin && callbackUrl !== "org2remote://auth/callback") {
        throw new MobileAuthClientError("Invalid native login callback", false);
      }
      // This SDK call only prepares a URL and persists the verifier; it does
      // not contact GitHub. Cloud owns the actual provider choice.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: callbackUrl,
          skipBrowserRedirect: true,
          scopes: "read:user user:email",
        },
      });
      if (error || !data.url) throw toMobileAuthClientError(error);
      if (useCloudLogin) {
        const authorization = new URL(data.url);
        const challenge = authorization.searchParams.get("code_challenge");
        if (
          !challenge ||
          !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
          authorization.searchParams
            .get("code_challenge_method")
            ?.toLowerCase() !== "s256"
        ) {
          throw new MobileAuthClientError(
            "Secure login preparation failed",
            false
          );
        }
        const login = new URL("/login", ORG2_CLOUD_OFFICIAL_WEB_ORIGIN);
        login.searchParams.set("return_to", callbackUrl);
        login.searchParams.set("code_challenge", challenge);
        login.searchParams.set("code_challenge_method", "s256");
        return login.toString();
      }
      return data.url;
    },

    async exchangeCallback(callbackUrl) {
      try {
        const parsed = new URL(callbackUrl);
        const code = parsed.searchParams.get("code")?.trim();
        if (!code || parsed.hash) {
          throw new MobileAuthClientError(
            "Authentication callback is incomplete",
            false
          );
        }
        const result = await supabase.auth.exchangeCodeForSession(code);
        if (result.error || !result.data.session) {
          throw toMobileAuthClientError(result.error);
        }
        return toMobileSession(result.data.session);
      } catch (error) {
        throw toMobileAuthClientError(error);
      }
    },

    async restoreSession(stored, options) {
      if (
        stored.supabaseUrl !== ORG2_CLOUD_OFFICIAL_SUPABASE_URL ||
        stored.supabaseAnonKey !== ORG2_CLOUD_OFFICIAL_ANON_KEY
      ) {
        throw new MobileAuthClientError(
          "This session belongs to a different ORG2 Cloud endpoint",
          false
        );
      }
      try {
        const shouldRefresh =
          options?.forceRefresh === true ||
          stored.expiresAt <= now() / 1_000 + EXPIRY_SKEW_SECONDS;
        const result = shouldRefresh
          ? await supabase.auth.refreshSession({
              refresh_token: stored.refreshToken,
            })
          : await supabase.auth.setSession({
              access_token: stored.accessToken,
              refresh_token: stored.refreshToken,
            });
        if (result.error || !result.data.session) {
          throw toMobileAuthClientError(result.error);
        }
        return toMobileSession(result.data.session, stored);
      } catch (error) {
        throw toMobileAuthClientError(error);
      }
    },

    async establishServerSession(accessToken) {
      if (serverSessionUrl === null) return;
      let response: Response;
      try {
        response = await authFetch(serverSessionUrl, {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (error) {
        throw toMobileAuthClientError(error);
      }
      if (!response.ok) {
        throw new MobileAuthClientError(
          `Mobile session exchange failed (${response.status})`,
          !isPermanentStatus(response.status)
        );
      }
    },

    async signOut(session) {
      if (serverSessionUrl !== null) {
        await authFetch(serverSessionUrl, {
          method: "DELETE",
          credentials: "include",
        }).catch(() => undefined);
      }
      if (session) {
        await supabase.auth
          .setSession({
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
          })
          .catch(() => undefined);
      }
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    },
  };
}
