/**
 * Replay / fork actions for one cloud org's remote sessions.
 *
 * Extracted from CloudOrgPanelView's handleReplaySession / handleForkSession
 * so the sidebar's threaded cloud-session rows can reuse the exact same
 * import/fork/openSession/toast/retention semantics. Replay/fork ride the
 * SAME backend-agnostic machinery as the self-hosted panel
 * (`importRemoteSession` / `forkTeammateSession`); only the segments fetch
 * differs (`buildCloudSessionFetchClient`, JWT-backed).
 *
 * This file composes the two actions: shared dependencies live in
 * `useCloudSessionActions.shared.ts`, the replay action in `.replay.ts`, the
 * fork action in `.fork.ts`, the big-session play gate and paused-download
 * commit in `.downloadGate.ts`, and the public types in `.types.ts`.
 */
import { useAtomValue } from "jotai";

import { cloudSessionBusyRowsAtom } from "./cloudSessionBusyAtom";
import { useCloudSessionForkAction } from "./useCloudSessionActions.fork";
import { useCloudSessionReplayAction } from "./useCloudSessionActions.replay";
import { useCloudSessionActionDeps } from "./useCloudSessionActions.shared";
import type { UseCloudSessionActionsResult } from "./useCloudSessionActions.types";

export type {
  CloudSessionActionOutcome,
  CloudSessionForkOptions,
  CloudSessionReplayOptions,
  UseCloudSessionActionsResult,
} from "./useCloudSessionActions.types";

/** Per-org replay/fork actions for cloud remote-session rows. */
export function useCloudSessionActions(
  orgId: string | null
): UseCloudSessionActionsResult {
  const deps = useCloudSessionActionDeps(orgId);
  const busySessionRows = useAtomValue(cloudSessionBusyRowsAtom);
  const replaySession = useCloudSessionReplayAction(deps);
  const forkSession = useCloudSessionForkAction(deps);

  return {
    replaySession,
    forkSession,
    busySessionRows,
  };
}
