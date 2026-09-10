import React, { useCallback } from "react";

import { DeferredSessionHoverCardContent } from "./DeferredSessionHoverCardContent";
import HoverCardBase, { type HoverCardPosition } from "./HoverCardBase";

interface SessionHoverCardProps {
  sessionId?: string | null;
  children: React.ReactElement;
  position?: HoverCardPosition;
  mouseEnterDelay?: number;
  mouseLeaveDelay?: number;
}

const SessionHoverCard: React.FC<SessionHoverCardProps> = ({
  sessionId,
  children,
  position,
  mouseEnterDelay,
  mouseLeaveDelay,
}) => {
  const renderContent = useCallback(
    (cardId: string) => <DeferredSessionHoverCardContent sessionId={cardId} />,
    []
  );

  return (
    <HoverCardBase
      cardId={sessionId}
      position={position}
      mouseEnterDelay={mouseEnterDelay}
      mouseLeaveDelay={mouseLeaveDelay}
      renderContent={renderContent}
    >
      {children}
    </HoverCardBase>
  );
};

export default SessionHoverCard;
