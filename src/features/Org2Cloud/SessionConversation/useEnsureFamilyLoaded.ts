import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";

import { buildCloudSessionFetchClient } from "@src/features/Org2Cloud/org2CloudBackendAdapter";
import { importRemoteSession } from "@src/features/TeamCollaboration/engine/collabSessionImport";
import { createLogger } from "@src/hooks/logger";
import { BoundedMap } from "@src/util/collections/BoundedMap";

import {
  commitRefreshedAuth,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "../org2CloudAuthAtom";
import { ensureFreshSession } from "../org2CloudClient";
import type { ConversationFamilyMember } from "./continuationEvents";

const log = createLogger("ConversationFamilyLoader");
const MAX_FAMILY_IMPORT_CONCURRENCY = 4;

/**
 * Last import position attempted per family member, keyed by org + session.
 *
 * The value is the member's replay position (`epoch:count`): a member whose
 * owner pushes more events no longer matches, so it gets a fresh (incremental)
 * import and open conversations keep following the family without
 * re-downloading unchanged transcripts.
 *
 * This used to be a `Set` keyed by org + session + position, which meant every
 * push by every member added a permanent entry — the set grew for the lifetime
 * of the process, in step with how active the org was. Keying by member and
 * holding the position as the value makes it one entry per member instead of
 * one per push, and the cap bounds the number of distinct members.
 */
const MAX_TRACKED_FAMILY_MEMBERS = 256;

const attemptedImportPositions = new BoundedMap<string, string>({
  maxSize: MAX_TRACKED_FAMILY_MEMBERS,
  name: "ConversationFamilyLoader.attemptedImports",
});

/**
 * Silently import family members the viewer has no local copy of, so their
 * segments stream into the conversation like any other message — no
 * placeholder divider, no manual replay click. The import engine dedups
 * concurrent calls per session, upserts the local row itself, and streams
 * incrementally when a cursor exists, so this stays cheap on refreshes.
 */
export function useEnsureFamilyLoaded(
  family: readonly ConversationFamilyMember[] | null,
  loadedBareSessionIds: ReadonlySet<string>,
  anchorBareSessionId: string
): void {
  const auth = useAtomValue(org2CloudAuthAtom);
  const setAuth = useSetAtom(org2CloudAuthAtom);
  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  const failedImportRef = useRef(false);
  const [foregroundRetryVersion, setForegroundRetryVersion] = useState(0);

  // A background failure must remain retryable, but retry only at an
  // explicit foreground boundary. `importRemoteSession` owns the actual
  // per-source serialization and durable cursor/no-op decision.
  useEffect(() => {
    if (
      !family ||
      !authIdentityKey ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return undefined;
    }
    let wasAway = false;
    const markAway = () => {
      wasAway = true;
    };
    const retryFailedImports = () => {
      if (
        document.visibilityState === "hidden" ||
        (typeof document.hasFocus === "function" && !document.hasFocus())
      ) {
        markAway();
        return;
      }
      if (!wasAway || !failedImportRef.current) return;
      wasAway = false;
      failedImportRef.current = false;
      setForegroundRetryVersion((version) => version + 1);
    };
    window.addEventListener("blur", markAway);
    window.addEventListener("focus", retryFailedImports);
    document.addEventListener("visibilitychange", retryFailedImports);
    return () => {
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", retryFailedImports);
      document.removeEventListener("visibilitychange", retryFailedImports);
    };
  }, [authIdentityKey, family]);

  useEffect(() => {
    const requestAuth = auth;
    if (!family || !requestAuth || !authIdentityKey) return;
    const pending = family.filter((member) => {
      const bareSessionId = member.bareSessionId;
      const row = member.row;
      if (
        !(
          bareSessionId !== anchorBareSessionId &&
          !loadedBareSessionIds.has(bareSessionId) &&
          !row.deletedAt &&
          row.eventsEpoch !== undefined &&
          Boolean(row.eventsCount) &&
          row.id !== `local-${bareSessionId}`
        )
      ) {
        return false;
      }
      const memberKey = `${authIdentityKey}:${row.orgId}:${bareSessionId}`;
      const position = `${row.eventsEpoch}:${row.eventsCount}`;
      if (attemptedImportPositions.get(memberKey) === position) return false;
      attemptedImportPositions.set(memberKey, position);
      return true;
    });
    let cancelled = false;
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (cancelled) return;
        const member = pending[cursor];
        cursor += 1;
        if (!member) return;
        const bareSessionId = member.bareSessionId;
        const row = member.row;
        const memberKey = `${authIdentityKey}:${row.orgId}:${bareSessionId}`;
        const position = `${row.eventsEpoch}:${row.eventsCount}`;
        try {
          const fresh = await ensureFreshSession(requestAuth);
          if (!fresh) {
            if (attemptedImportPositions.peek(memberKey) === position) {
              attemptedImportPositions.delete(memberKey);
            }
            failedImportRef.current = true;
            return;
          }
          if (
            cancelled ||
            org2CloudAuthIdentityKey(fresh) !== authIdentityKey
          ) {
            if (attemptedImportPositions.peek(memberKey) === position) {
              attemptedImportPositions.delete(memberKey);
            }
            return;
          }
          commitRefreshedAuth(setAuth, requestAuth, fresh);
          await importRemoteSession({
            client: buildCloudSessionFetchClient(fresh.accessToken),
            orgId: row.orgId,
            remoteSession: row,
            sourceEndpointUrl: requestAuth.supabaseUrl,
          });
        } catch (error) {
          if (attemptedImportPositions.peek(memberKey) === position) {
            attemptedImportPositions.delete(memberKey);
          }
          failedImportRef.current = true;
          log.warn(
            `background family import failed for ${bareSessionId}`,
            error
          );
        }
      }
    };
    void Promise.all(
      Array.from(
        { length: Math.min(MAX_FAMILY_IMPORT_CONCURRENCY, pending.length) },
        worker
      )
    );
    return () => {
      cancelled = true;
    };
  }, [
    family,
    loadedBareSessionIds,
    anchorBareSessionId,
    auth,
    authIdentityKey,
    foregroundRetryVersion,
    setAuth,
  ]);
}
