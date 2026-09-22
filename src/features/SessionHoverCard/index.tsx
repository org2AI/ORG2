import React from "react";

import HoverCard, {
  type HoverCardTriggerProps,
} from "@src/components/HoverCard";

import { DeferredSessionHoverCardContent } from "./DeferredSessionHoverCardContent";

interface SessionHoverCardProps extends HoverCardTriggerProps {
  sessionId?: string | null;
}

const SessionHoverCard: React.FC<SessionHoverCardProps> = ({
  sessionId,
  position,
  ...triggerProps
}) => {
  return (
    <HoverCard
      {...triggerProps}
      cardId={sessionId}
      position={position}
      content={
        sessionId ? (
          <DeferredSessionHoverCardContent sessionId={sessionId} />
        ) : null
      }
    />
  );
};

export default SessionHoverCard;
