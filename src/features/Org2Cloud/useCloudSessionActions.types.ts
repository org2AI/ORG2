/**
 * useCloudSessionActions — public option / outcome / result types.
 */
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

import type { CloudSessionBusyEntry } from "./cloudSessionBusyAtom";

export interface CloudSessionReplayOptions {
  /**
   * Surface that should show the replay, called synchronously with the local
   * session id the import will write into — before the remote transcript is
   * fetched. Defaults to opening/replacing a Chat Pane session tab.
   *
   * Boards that are themselves unmounted by a tab switch (Work Management
   * only mounts while its tab is active) MUST pass their own in-place
   * surface: opening a tab would tear down the caller and abort the import
   * it just started, leaving the new tab permanently empty.
   */
  openSurface?: (params: {
    localSessionId: string;
    remoteSession: RemoteTeammateSessionMetadata;
  }) => void;
  /**
   * True for starts the user already confirmed (the play card's Start
   * button): the big-session play gate is skipped and the transfer begins
   * immediately. Resumes of paused downloads skip the gate on their own.
   */
  skipDownloadGate?: boolean;
}

export interface CloudSessionForkOptions {
  /** True for starts the play card's Start button already confirmed. */
  skipDownloadGate?: boolean;
}

export type CloudSessionActionOutcome =
  | "opened"
  /** The click raced past the server-side retention filter — show upgrade. */
  | "retention-expired"
  | "failed"
  /** Row not actionable (nothing published / another action in flight). */
  | "noop";

export interface UseCloudSessionActionsResult {
  replaySession: (
    remoteSession: RemoteTeammateSessionMetadata,
    options?: CloudSessionReplayOptions
  ) => Promise<CloudSessionActionOutcome>;
  forkSession: (
    remoteSession: RemoteTeammateSessionMetadata,
    options?: CloudSessionForkOptions
  ) => Promise<CloudSessionActionOutcome>;
  /**
   * Row ids (`remoteSession.id`) with a replay/fork in flight. Per-row and
   * store-backed: a busy row only ever blocks itself, and every mounted
   * consumer (both sidebar connectors, Kanban) sees the same registry.
   */
  busySessionRows: ReadonlyMap<string, CloudSessionBusyEntry>;
}
