/**
 * Anchor-presence bridge for `SessionCommentsContext`: the source-event-id
 * projection every comment anchors by, and the session-id-keyed registry the
 * header notes dialog reads (it renders outside ChatView).
 */
import { atom, useSetAtom } from "jotai";
import { useEffect, useId } from "react";

import type { Session } from "@src/store/session/sessionAtom/types";

import { stripCopyEventNamespace } from "../../TeamCollaboration/copyEventId";
import type { CommentAnchorEventIdentity } from "./commentAnchorIdentities";

const RUST_NATIVE_TRANSIENT_USER_EVENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Build the local-render id -> durable cloud-anchor id projection once per
 * transcript. Rust-native live broadcasts briefly expose a bare message UUID,
 * while the persisted event uploaded to cloud is `user-message-${uuid}`.
 * Imports/forks additionally namespace that durable id with their local
 * session id. Comments must use the durable source-plane spelling in all
 * three states or a thread posted during the live turn disappears on reload
 * and cannot be seen by an imported replay.
 */
export function buildCloudCommentSourceEventIdMap(
  session: Pick<Session, "session_id" | "category">,
  events: readonly CommentAnchorEventIdentity[]
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const event of events) {
    const bareEventId = stripCopyEventNamespace(session.session_id, event.id);
    const sourceEventId =
      session.category === "rust_agent" &&
      event.source === "user" &&
      RUST_NATIVE_TRANSIENT_USER_EVENT_ID.test(bareEventId)
        ? `user-message-${bareEventId}`
        : bareEventId;
    result.set(event.id, sourceEventId);
  }
  return result;
}

/**
 * Replay-stream event ids per LOCAL session id, registered by every mounted
 * provider — keyed session id → PROVIDER INSTANCE id → id set, because two
 * panes can show the SAME session (split panes / editor tabs) and a single
 * slot per session would let whichever pane unmounts first delete the
 * surviving pane's entry (silently emptying the header dialog's orphan
 * bucket). Readers merge the instances via `mergePresentEventIdEntries`;
 * a missing/empty session entry means "presence unknown" and
 * `groupCommentThreads` then never classifies orphans.
 */
export const sessionCommentPresentEventIdsAtom = atom<
  Record<string, Record<string, ReadonlySet<string>>>
>({});
sessionCommentPresentEventIdsAtom.debugLabel =
  "sessionCommentPresentEventIdsAtom";

/**
 * Publish the replay stream's event ids for the header notes dialog —
 * only for cloud targets, so ordinary sessions cause zero registry churn.
 * Keyed by PROVIDER INSTANCE under the session id: two panes on the same
 * session each own their sub-entry, so the first pane to unmount can
 * never delete the surviving pane's ids (readers union the instances).
 */
export function usePublishSessionCommentPresentEventIds(
  localSessionId: string | null,
  presentEventIds: ReadonlySet<string> | null
): void {
  const setPresentRegistry = useSetAtom(sessionCommentPresentEventIdsAtom);
  const providerId = useId();
  useEffect(() => {
    if (!localSessionId || !presentEventIds) return;
    setPresentRegistry((previous) => ({
      ...previous,
      [localSessionId]: {
        ...previous[localSessionId],
        [providerId]: presentEventIds,
      },
    }));
    return () => {
      setPresentRegistry((previous) => {
        const forSession = previous[localSessionId];
        if (!forSession || !(providerId in forSession)) return previous;
        const { [providerId]: _removed, ...restInstances } = forSession;
        if (Object.keys(restInstances).length === 0) {
          const { [localSessionId]: _session, ...restSessions } = previous;
          return restSessions;
        }
        return { ...previous, [localSessionId]: restInstances };
      });
    };
  }, [localSessionId, presentEventIds, providerId, setPresentRegistry]);
}
