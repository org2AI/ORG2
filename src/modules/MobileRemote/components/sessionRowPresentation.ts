import { IMPORTED_HISTORY_SOURCE_DESCRIPTORS } from "@src/api/tauri/externalHistory/imported/descriptors";
import {
  type SessionStatus,
  isActiveStatus,
  isTerminalStatus,
} from "@src/types/session/session";
import type { LocalSessionDisplayInput } from "@src/util/session/sessionDisplayMetadata";

import type {
  MobileSessionDisplay,
  MobileSessionRow,
} from "../connection/types";

export type MobileRowStatus =
  | SessionStatus
  | "installing"
  | "offline"
  | "awaiting_approval"
  | "unknown";

/** Projection only: never use a display status to drive a session command. */
export function mobileSessionRowStatus(
  session: MobileSessionRow
): MobileRowStatus {
  const status = session.lifecycleStatus;
  if (status == null) return session.status;
  if (isActiveStatus(status) || isTerminalStatus(status))
    return status as MobileRowStatus;
  return "unknown";
}

export function mobileSessionIconInput(
  sessionId: string,
  display?: MobileSessionDisplay
): LocalSessionDisplayInput {
  const source = IMPORTED_HISTORY_SOURCE_DESCRIPTORS.find(
    (item) => item.sourceId === display?.externalHistorySource
  );
  return {
    session_id: sessionId,
    ...display,
    importedFrom: source
      ? { externalHistorySource: source.sourceId }
      : undefined,
  };
}
