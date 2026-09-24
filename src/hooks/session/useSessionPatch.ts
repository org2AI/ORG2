/**
 * useSessionPatch
 *
 * In-session field mutation hook.
 *
 * Per-session input state (model, account, exec mode) lives in the
 * Rust `agent_sessions` / `code_sessions` tables — see
 * `docs/session/per-session-input-state-audit-and-plan--0430.md`.
 * UI components that let the user edit those fields (`ModelPalette`,
 * `ModePill`) call into this hook so:
 *
 *  1. The optimistic update happens immediately (`upsertSession`).
 *  2. The Rust patch lands in the background.
 *  3. On error, the optimistic write is rolled back to the previous
 *     value and the error is surfaced (toast left to the caller —
 *     pill UIs already render error states).
 *
 * Two narrow surfaces deliberately wrap the same `rpc.sessionAggregate.patch`
 * call rather than exposing the raw `SessionPatch` shape:
 *
 *  - `useSessionModelField` — atomic `(model, accountId)` swap. Most
 *    callers know both at once because the model picker resolves the
 *    backing key.
 *  - `useSessionComposerModeFields` — atomic product-mode + derived
 *    exec-mode swap. Project is persisted as `productMode=project`
 *    together with `agentExecMode=build`; ordinary Build is persisted
 *    as `productMode=build` + `agentExecMode=build`.
 *
 * Both share `usePatchSession` for the optimistic + rollback machinery
 * so future fields (drafts in P3) only need a thin wrapper.
 */
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import { sessionByIdAtom, upsertSession } from "@src/store/session";
import {
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";

import {
  type SessionPatchOptions,
  createSessionPatchQueue,
} from "./sessionPatchQueue";

type PatchOptions = SessionPatchOptions;

interface PatchState {
  isPatching: boolean;
  error: string | null;
}

const patchQueues = new WeakMap<
  ReturnType<typeof getInstrumentedStore>,
  ReturnType<typeof createSessionPatchQueue>
>();

function sessionPatchQueue() {
  const store = getInstrumentedStore();
  let queue = patchQueues.get(store);
  if (!queue) {
    queue = createSessionPatchQueue({
      read: (id) =>
        isStoreInitialized() && getInstrumentedStore() === store
          ? store.get(sessionByIdAtom(id))
          : undefined,
      publish: (session) => {
        if (isStoreInitialized() && getInstrumentedStore() === store)
          upsertSession(session);
      },
      subscribe: (id, changed) => store.sub(sessionByIdAtom(id), changed),
      persist: async (sessionId, patch) => {
        await rpc.sessionAggregate.patch({ sessionId, patch });
      },
    });
    patchQueues.set(store, queue);
  }
  return queue;
}

/** Shared ordered persistence; only the latest call controls hook feedback. */
function usePatchSession(): {
  patch: (sessionId: string, patch: PatchOptions) => Promise<void>;
} & PatchState {
  const [state, setState] = useState<PatchState>({
    isPatching: false,
    error: null,
  });
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    []
  );

  const patch = useCallback(
    async (sessionId: string, options: PatchOptions) => {
      const current = ++generation.current;
      setState({ isPatching: true, error: null });
      try {
        await sessionPatchQueue()(sessionId, options);
        if (current === generation.current)
          setState({ isPatching: false, error: null });
      } catch (error) {
        if (current === generation.current) {
          setState({
            isPatching: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
    []
  );
  return { patch, ...state };
}

/**
 * Read+write the per-session model/account pair.
 *
 * Returns the current values (from `sessionByIdAtom`) plus a
 * `setModel` function that performs an atomic backend patch.
 *
 * Omit `accountId` to leave it unchanged when only the model
 * name changes (e.g. switching between two Anthropic models on the
 * same key).
 */
export function useSessionModelField(sessionId: string) {
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const { patch, isPatching, error } = usePatchSession();

  const setModel = useCallback(
    (model: string, accountId?: string) =>
      patch(sessionId, { model, accountId }),
    [patch, sessionId]
  );

  return {
    model: session?.model,
    accountId: session?.accountId,
    setModel,
    isPatching,
    error,
  };
}

/**
 * Read+write the per-session exec mode.
 *
 * Returns the current value (or `undefined` for a historical row that has
 * not yet been normalized) plus a `setMode`
 * function that performs the backend patch.
 *
 * Both native and CLI-backed sessions carry this field.
 */
export function useSessionExecModeField(sessionId: string) {
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const { patch, isPatching, error } = usePatchSession();

  const setMode = useCallback(
    (mode: string) => patch(sessionId, { agentExecMode: mode }),
    [patch, sessionId]
  );

  return {
    agentExecMode: session?.agentExecMode,
    setMode,
    isPatching,
    error,
  };
}

/**
 * Read and atomically write the two axes behind the composer mode picker.
 *
 * Keeping these values in one RPC is a correctness requirement: two
 * fire-and-forget patches could let an immediately submitted turn observe
 * `productMode=project` with the previous Ask/Plan execution policy, or drop
 * Project while its PM capability was still visible to the runner.
 */
export function useSessionComposerModeFields(sessionId: string) {
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const { patch, isPatching, error } = usePatchSession();

  const setComposerMode = useCallback(
    (productMode: string, agentExecMode: string) =>
      patch(sessionId, { productMode, agentExecMode }),
    [patch, sessionId]
  );

  return {
    agentExecMode: session?.agentExecMode,
    productMode: session?.productMode,
    setComposerMode,
    isPatching,
    error,
  };
}

/** Default debounce window for draft writes. Each keystroke schedules a
 *  patch; new keystrokes within this window cancel the prior schedule.
 *  300ms strikes a balance between "feels instant on paste / send" and
 *  "doesn't hammer SQLite on every keystroke". Tunable per-call via
 *  the `debounceMs` argument to `useSessionDraftField`. */
const DEFAULT_DRAFT_DEBOUNCE_MS = 300;

/**
 * Read+write the per-session draft text (P3).
 *
 * The chat composer stores the user's unsent text on the session row so
 * it survives navigation, app restarts, and background row refreshes
 * (the upsert path explicitly preserves `draft_text` — see
 * `UPSERT_SESSION_SQL`). This hook gives the composer:
 *
 *  - `draftText` — the persisted value to seed the editor with on mount
 *    or session switch.
 *  - `setDraft(text)` — debounced write; pass `""` to clear.
 *  - `flushDraft(text)` — immediate write; the composer calls this on
 *    `send` so the queued message can clear the draft synchronously
 *    instead of racing the debounce timer.
 *
 * Empty string is treated as "clear" — the Rust helper normalizes it to
 * SQL NULL, and on the wire we send `null` so the column is cleared
 * rather than left with an empty string nobody intends to read back.
 *
 * NOT to be confused with `sessionCreatorDraftAtom`
 * (`src/store/session/creatorDraftAtom.ts`): that is the
 * **pre-launch** SessionCreator's localStorage-backed single draft
 * slot for composing a *new* session. This hook covers **post-launch**
 * per-existing-session ChatPanel composer state. The two never share
 * the same logical message — the SessionCreator draft is consumed
 * (sent as the first user_message) and cleared at launch time.
 */
export function useSessionDraftField(
  sessionId: string,
  debounceMs: number = DEFAULT_DRAFT_DEBOUNCE_MS
) {
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const { patch, isPatching, error } = usePatchSession();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the most recently-scheduled value so the timer callback writes
  // the freshest text, not a stale closure capture.
  const pendingRef = useRef<string | null>(null);

  // Cancel any pending write when the session id changes — a draft
  // queued for session A should not race a session-switch into session
  // B and overwrite the wrong row.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
    };
  }, [sessionId]);

  const flushDraft = useCallback(
    (text: string) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
      // Empty string → null on the wire so SQLite stores NULL (matches
      // the Rust `update_draft_text` empty-string normalization).
      const wire = text === "" ? null : text;
      return patch(sessionId, { draftText: wire });
    },
    [patch, sessionId]
  );

  const setDraft = useCallback(
    (text: string) => {
      pendingRef.current = text;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const value = pendingRef.current;
        pendingRef.current = null;
        if (value === null) return;
        const wire = value === "" ? null : value;
        // Fire and forget — errors are tracked via `error` state and
        // the optimistic update has already taken effect. We do not
        // surface a draft-write rejection to the user since the next
        // keystroke will retry.
        void patch(sessionId, { draftText: wire }).catch(() => {});
      }, debounceMs);
    },
    [debounceMs, patch, sessionId]
  );

  return {
    draftText: session?.draftText,
    setDraft,
    flushDraft,
    isPatching,
    error,
  };
}

/**
 * Read+write the per-session reply target event id (P3).
 *
 * The chat composer pins a reply target when the user clicks "Reply"
 * on a chat item, and clears it when the banner is dismissed or the
 * follow-up message is sent. Persisting it on the session row means
 * the banner survives navigation, app restarts, and background row
 * refreshes — same posture as `draftText`.
 *
 */
export function useSessionReplyField(sessionId: string) {
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const { patch, isPatching, error } = usePatchSession();

  const setReplyTarget = useCallback(
    (eventId: string | null) =>
      patch(sessionId, { replyTargetEventId: eventId }),
    [patch, sessionId]
  );

  const clearReplyTarget = useCallback(
    () => patch(sessionId, { replyTargetEventId: null }),
    [patch, sessionId]
  );

  return {
    replyTargetEventId: session?.replyTargetEventId,
    setReplyTarget,
    clearReplyTarget,
    isPatching,
    error,
  };
}

/** Command writes share the same optimistic persistence/rollback owner as pills. */
export function useSessionCommandActions(sessionId: string) {
  const { patch } = usePatchSession();
  const setPlan = useCallback(
    () => patch(sessionId, { productMode: "plan", agentExecMode: "plan" }),
    [patch, sessionId]
  );
  const rename = useCallback(
    (name: string) => patch(sessionId, { name }),
    [patch, sessionId]
  );
  return { setPlan, rename };
}
