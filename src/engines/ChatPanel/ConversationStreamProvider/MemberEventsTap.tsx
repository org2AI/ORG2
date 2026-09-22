import { useAtomValue } from "jotai";
import React from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { chatEventsForSessionAtomFamily } from "@src/engines/SessionCore/derived/sessionScopedChatEvents";
import { useSessionEventIngestion } from "@src/engines/SessionCore/sync/useSessionEventIngestion";

interface MemberEventsTapProps {
  bareSessionId: string;
  localSessionId: string;
  ingestLive?: boolean;
  onEvents: (bareSessionId: string, events: SessionEvent[]) => void;
  onUnmount?: (bareSessionId: string) => void;
}

/** Invisible per-family-member subscription; the atom self-hydrates on mount. */
export function MemberEventsTap({
  bareSessionId,
  localSessionId,
  ingestLive = false,
  onEvents,
  onUnmount,
}: MemberEventsTapProps): null {
  useSessionEventIngestion(ingestLive ? localSessionId : null);
  const events = useAtomValue(chatEventsForSessionAtomFamily(localSessionId));
  React.useEffect(() => {
    onEvents(bareSessionId, events);
  }, [bareSessionId, events, onEvents]);
  React.useEffect(
    () => () => {
      onUnmount?.(bareSessionId);
    },
    [bareSessionId, onUnmount]
  );
  return null;
}
