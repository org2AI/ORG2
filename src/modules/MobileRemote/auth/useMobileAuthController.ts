import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { useMobileRemotePlatform } from "../platform";
import {
  type MobileAuthClient,
  MobileAuthClientError,
  isRetryableMobileAuthError,
} from "./mobileAuthClient";
import {
  createInitialMobileAuthState,
  reduceMobileAuthState,
} from "./mobileAuthState";

const EXPIRY_REFRESH_SKEW_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_000_000;

// A replacement owner must wait for already-issued SDK/Keychain operations.
// Generation checks prevent new stale writes, but cannot cancel a write in progress.
const retiredAuthOwners = new WeakMap<object, Promise<void>>();

/** Owns authentication episodes independently of the rendered gate. */
export function useMobileAuthController({
  client: providedClient,
  navigate,
}: {
  client?: MobileAuthClient;
  navigate?: (url: string) => void;
}) {
  const platform = useMobileRemotePlatform();
  const [state, dispatch] = useReducer(
    reduceMobileAuthState,
    undefined,
    createInitialMobileAuthState
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);
  const expiryTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const signOutCleanupRef = useRef<Promise<void> | null>(null);
  const signInPreparationRef = useRef<Promise<void> | null>(null);
  const signInCancelledRef = useRef(false);
  const intentGenerationRef = useRef(0);
  const clientRef = useRef<MobileAuthClient | null>(null);
  clientRef.current ??= providedClient ?? platform.auth.createClient();

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current !== null) {
      platform.runtime.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, [platform.runtime]);

  const authenticate = useCallback(
    (options: { forceRefresh?: boolean } = {}) => {
      if (inFlightRef.current) return inFlightRef.current;
      const generation = ++generationRef.current;
      const callback = platform.auth.isCallback();
      const callbackUrl = platform.auth.currentUrl();

      if (callback) {
        dispatch({ type: "begin", phase: "exchanging", generation });
        platform.auth.scrubCallback();
      } else if (
        stateRef.current.phase !== "signed_in" ||
        stateRef.current.session.expiresAt <= platform.runtime.now() / 1_000
      ) {
        dispatch({ type: "begin", phase: "checking", generation });
      }

      const predecessor = retiredAuthOwners.get(platform.auth);
      const operation = (async () => {
        try {
          await predecessor;
          if (generation !== generationRef.current) return;
          let session;
          if (callback) {
            if (!(await platform.auth.consumeOAuthAttempt())) {
              throw new MobileAuthClientError(
                "Authentication callback has expired",
                false
              );
            }
            if (generation !== generationRef.current) return;
            session = await clientRef.current!.exchangeCallback(callbackUrl);
          } else {
            const stored = await platform.auth.readSession();
            if (generation !== generationRef.current) return;
            if (!stored) {
              dispatch({ type: "signed_out", generation });
              return;
            }
            session = await clientRef.current!.restoreSession(stored, options);
          }
          if (generation !== generationRef.current) return;

          // Persist the rotating refresh token before the server-session
          // exchange. A transient exchange failure can then recover on Retry
          // without replaying an already-scrubbed OAuth callback.
          await platform.auth.writeSession(session);
          if (generation !== generationRef.current) return;
          await clientRef.current!.establishServerSession(session.accessToken);
          if (generation !== generationRef.current) return;

          const recoveredPairingIntent =
            await platform.auth.consumePairingIntent();
          if (generation !== generationRef.current) return;
          dispatch({
            type: "signed_in",
            generation,
            session,
            recoveredPairingIntent,
          });
        } catch (error) {
          if (generation !== generationRef.current) return;
          const retryable = isRetryableMobileAuthError(error);
          if (!retryable) await platform.auth.clearSession();
          if (generation !== generationRef.current) return;
          dispatch({
            type: "failed",
            generation,
            message:
              error instanceof Error ? error.message : "Authentication failed",
            retryable,
          });
        }
      })();
      inFlightRef.current = operation;
      void operation
        .finally(() => {
          if (inFlightRef.current === operation) inFlightRef.current = null;
        })
        .catch(() => undefined);
      return operation;
    },
    [platform.auth, platform.runtime]
  );

  useEffect(() => {
    void authenticate().catch(() => undefined);
    return () => {
      generationRef.current += 1;
      intentGenerationRef.current += 1;
      clearExpiryTimer();
      const drained = Promise.allSettled([
        retiredAuthOwners.get(platform.auth),
        inFlightRef.current,
        signInPreparationRef.current,
        signOutCleanupRef.current,
      ]).then(() => undefined);
      retiredAuthOwners.set(platform.auth, drained);
      void drained
        .then(() => {
          if (retiredAuthOwners.get(platform.auth) === drained) {
            retiredAuthOwners.delete(platform.auth);
          }
        })
        .catch(() => undefined);
      inFlightRef.current = null;
    };
  }, [authenticate, clearExpiryTimer, platform.auth]);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = platform.auth.subscribeIntent((event) => {
      if (event === "auth_callback" && signInCancelledRef.current) {
        platform.auth.scrubCallback();
        return;
      }
      const intentGeneration = ++intentGenerationRef.current;
      const pendingAuthentication = inFlightRef.current;
      if (pendingAuthentication) {
        // The deep link is a newer user intent. Invalidate the old episode,
        // then consume the latest callback/pairing value after it settles.
        generationRef.current += 1;
      }
      void Promise.allSettled([
        pendingAuthentication ?? Promise.resolve(),
        signOutCleanupRef.current ?? Promise.resolve(),
      ])
        .then(() => {
          if (!disposed && intentGeneration === intentGenerationRef.current) {
            void authenticate().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    });
    return () => {
      disposed = true;
      intentGenerationRef.current += 1;
      unsubscribe();
    };
  }, [authenticate, platform.auth]);

  const startSignIn = useCallback(() => {
    signInCancelledRef.current = false;
    const generation = ++generationRef.current;
    clearExpiryTimer();
    const attemptId = platform.runtime.randomUUID();
    dispatch({ type: "begin", phase: "redirecting", generation });
    const preparation = (signOutCleanupRef.current ?? Promise.resolve())
      .then(async () => {
        if (generation !== generationRef.current) return undefined;
        await platform.auth.beginOAuthAttempt(attemptId);
        if (generation !== generationRef.current) return undefined;
        return clientRef.current!.buildLoginUrl(platform.auth.callbackUrl());
      })
      .then((url) => {
        if (url && generation === generationRef.current) {
          return (navigate ?? platform.openExternal)(url);
        }
        return undefined;
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        dispatch({
          type: "failed",
          generation,
          message:
            error instanceof Error ? error.message : "Authentication failed",
          retryable: isRetryableMobileAuthError(error),
        });
      });
    signInPreparationRef.current = preparation;
    void preparation
      .finally(() => {
        if (signInPreparationRef.current === preparation)
          signInPreparationRef.current = null;
      })
      .catch(() => undefined);
  }, [
    clearExpiryTimer,
    navigate,
    platform.auth,
    platform.runtime,
    platform.openExternal,
  ]);

  const cancelSignIn = useCallback(() => {
    if (stateRef.current.phase !== "redirecting") return;
    signInCancelledRef.current = true;
    const generation = ++generationRef.current;
    intentGenerationRef.current += 1;
    dispatch({ type: "signed_out", generation });
    // Serialize cancellation with a pending Keychain write. Keep pairing intent.
    const cleanup = (async () => {
      await signInPreparationRef.current;
      await platform.auth.consumeOAuthAttempt();
    })();
    signOutCleanupRef.current = cleanup;
    void cleanup.catch(() => {
      // A new login stays blocked on failed cleanup rather than reusing an attempt.
    });
  }, [platform.auth]);

  const signOut = useCallback(() => {
    const currentSession =
      stateRef.current.phase === "signed_in" ? stateRef.current.session : null;
    const generation = ++generationRef.current;
    const pendingAuthentication = inFlightRef.current;
    // Detach any refresh/callback operation from this auth episode. Its
    // generation guard still prevents stale completion from restoring state,
    // while a later sign-in is free to start immediately.
    inFlightRef.current = null;
    clearExpiryTimer();
    dispatch({ type: "signed_out", generation });
    const cleanup = (async () => {
      // Preserve final-write-wins semantics for async Keychain and server
      // session adapters. The stale operation remains generation-guarded;
      // sign-out cleanup runs after it and is therefore authoritative.
      await pendingAuthentication?.catch(() => undefined);
      const session =
        currentSession ?? (await platform.auth.readSession().catch(() => null));
      await Promise.allSettled([
        Promise.resolve().then(() => platform.auth.clearSession()),
        Promise.resolve().then(() => platform.auth.clearIntents()),
        Promise.resolve().then(() => clientRef.current!.signOut(session)),
      ]);
    })();
    signOutCleanupRef.current = cleanup;
    void cleanup
      .finally(() => {
        if (signOutCleanupRef.current === cleanup) {
          signOutCleanupRef.current = null;
        }
      })
      .catch(() => undefined);
  }, [clearExpiryTimer, platform.auth]);

  useEffect(() => {
    clearExpiryTimer();
    if (state.phase !== "signed_in" || platform.runtime.isHidden()) return;
    const delay = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(
        0,
        state.session.expiresAt * 1_000 -
          platform.runtime.now() -
          EXPIRY_REFRESH_SKEW_MS
      )
    );
    expiryTimerRef.current = platform.runtime.setTimeout(() => {
      expiryTimerRef.current = null;
      void authenticate({ forceRefresh: true }).catch(() => undefined);
    }, delay);
    return clearExpiryTimer;
  }, [authenticate, clearExpiryTimer, platform.runtime, state]);

  useEffect(() => {
    const handleVisibility = () => {
      clearExpiryTimer();
      if (
        !platform.runtime.isHidden() &&
        stateRef.current.phase === "signed_in"
      ) {
        void authenticate({ forceRefresh: true }).catch(() => undefined);
      }
    };
    const unsubscribe = platform.runtime.subscribeVisibility(handleVisibility);
    return () => {
      clearExpiryTimer();
      unsubscribe();
    };
  }, [authenticate, clearExpiryTimer, platform.runtime]);

  const getConnectionSession = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase !== "signed_in") throw new Error("Sign in to connect");
    if (
      inFlightRef.current ||
      current.session.expiresAt * 1000 <=
        platform.runtime.now() + EXPIRY_REFRESH_SKEW_MS
    ) {
      await authenticate();
    }
    const generation = generationRef.current;
    const session = await platform.auth.readSession();
    if (
      generation !== generationRef.current ||
      stateRef.current.phase !== "signed_in" ||
      !session ||
      session.userId !== current.session.userId ||
      session.supabaseUrl !== current.session.supabaseUrl ||
      session.expiresAt * 1000 <= platform.runtime.now()
    ) {
      throw new Error("Account session changed; reconnect after signing in");
    }
    return session;
  }, [authenticate, platform.auth, platform.runtime]);

  const contextValue = useMemo(
    () =>
      state.phase === "signed_in"
        ? {
            session: state.session,
            signOut,
            getConnectionSession,
            isDevelopmentBypass: false,
          }
        : null,
    [signOut, state, getConnectionSession]
  );

  return {
    state,
    contextValue,
    startSignIn,
    cancelSignIn,
    retry: authenticate,
  };
}
