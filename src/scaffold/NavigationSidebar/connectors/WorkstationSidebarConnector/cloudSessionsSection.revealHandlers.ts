/**
 * Cross-surface reveal handlers for `useCloudSessionsSection`: what a
 * session-reference chip does when its row resolves to the viewer's own local
 * session, to a row already downloading, or to nothing at all — wired into
 * the auto-replay reveal effect.
 */
import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useCallback } from "react";

import Message from "@src/components/Message";
import { dismissCloudReferenceOpeningToast } from "@src/features/Org2Cloud/cloudReferenceOpeningToast";
import type { CloudSessionBusyEntry } from "@src/features/Org2Cloud/cloudSessionBusyAtom";
import type { CloudRemoteSessionsFetchState } from "@src/features/Org2Cloud/org2CloudRemoteSessionsAtom";
import { REFUSAL_MESSAGE_DURATION_MS } from "@src/features/Org2Cloud/referenceRefusalMessage";
import type { CloudSessionReplayOptions } from "@src/features/Org2Cloud/useCloudSessionActions";
import { createLogger } from "@src/hooks/logger";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { openOrReplaceSessionInChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabOpen/session";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { loadSidebarSessionById } from "@src/store/session";

import {
  type CloudAutoReplaySkipReason,
  useCloudSessionAutoReplayReveal,
} from "./cloudSessionsSection.autoReplayReveal";

const log = createLogger("CloudSessionsSection");

export function useCloudSessionRevealHandlers({
  t,
  orgId,
  rows,
  state,
  fetchedAt,
  busySessionRows,
  selfUserId,
  localOwnSessionIds,
  handleRefreshClick,
  runReplay,
}: {
  t: TFunction;
  orgId: string | null;
  rows: readonly RemoteTeammateSessionMetadata[];
  state: CloudRemoteSessionsFetchState;
  fetchedAt: number;
  busySessionRows: ReadonlyMap<string, CloudSessionBusyEntry>;
  selfUserId: string | null;
  localOwnSessionIds: ReadonlySet<string>;
  handleRefreshClick: () => void;
  runReplay: (
    row: RemoteTeammateSessionMetadata,
    options?: CloudSessionReplayOptions
  ) => void;
}): void {
  const { openSession } = useSessionView();
  const openOrReplaceSessionTab = useSetAtom(
    openOrReplaceSessionInChatPanelTabAtom
  );
  // The chip's contract is "take me to this transcript". For the viewer's
  // own session that means opening the live local original — the bare
  // sidebar reveal alone highlights nothing unless the session is already
  // active, which read as a dead click.
  //
  // The reveal-local decision trusts persisted push markers, which can
  // outlive the local session (deleted locally while the cloud row and
  // marker survive until the vanished sweep). Confirm the session actually
  // exists — demand-hydrating one that is merely unloaded — before
  // repointing any tab at it; a stale marker earns the same refusal a
  // missing cloud row would.
  const handleRevealLocal = useCallback(
    (sessionId: string) => {
      dismissCloudReferenceOpeningToast();
      loadSidebarSessionById(sessionId)
        .then((local) => {
          if (!local) {
            Message.error(t("cloud.sessionRef.sessionNotFound"), {
              duration: REFUSAL_MESSAGE_DURATION_MS,
              closable: true,
            });
            return;
          }
          const sessionName = local.name ?? sessionId;
          openOrReplaceSessionTab({ sessionId, sessionName });
          openSession(sessionId, sessionName);
        })
        .catch((error) => {
          log.warn("revealing a local session failed:", error);
        });
    },
    [openOrReplaceSessionTab, openSession, t]
  );

  const handleAutoReplaySkip = useCallback(
    (reason: CloudAutoReplaySkipReason) => {
      dismissCloudReferenceOpeningToast();
      // Same rationale as the admission refusal toast: this skip is the ONLY
      // visible outcome of the click, and the 1s default reads as a dead chip.
      Message.error(
        reason === "not-found"
          ? t("cloud.sessionRef.sessionNotFound")
          : t("cloud.sidebar.notPublished"),
        { duration: REFUSAL_MESSAGE_DURATION_MS, closable: true }
      );
    },
    [t]
  );

  // A reference aimed at a row that is ALREADY downloading refocuses the
  // tab that download opened — same contract as clicking the busy row.
  const handleAutoReplayFocusBusy = useCallback(
    (row: RemoteTeammateSessionMetadata, localSessionId?: string) => {
      dismissCloudReferenceOpeningToast();
      if (!localSessionId) return;
      openOrReplaceSessionTab({
        sessionId: localSessionId,
        sessionName: row.title,
      });
    },
    [openOrReplaceSessionTab]
  );

  useCloudSessionAutoReplayReveal({
    orgId,
    rows,
    state,
    fetchedAt,
    busySessionRows,
    selfUserId,
    localOwnSessionIds,
    // The spin wrapper, not the raw refresh: the freshness probe a chip
    // triggers should be visible on the section's refresh icon.
    refresh: handleRefreshClick,
    runReplay,
    onRevealLocal: handleRevealLocal,
    onFocusBusy: handleAutoReplayFocusBusy,
    onSkip: handleAutoReplaySkip,
  });
}
