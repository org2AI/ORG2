import { SessionOpenInAppMenuItem } from "@src/engines/ChatPanel/components/SessionOpenInAppMenuItem";
import { useConversationTargetBinding } from "@src/engines/ChatPanel/hooks/useConversationTargetBinding";

/** Resolve only the open menu's conversation, using the same authority as its header. */
export function SidebarSessionOpenInApp({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const binding = useConversationTargetBinding(sessionId);
  return (
    <SessionOpenInAppMenuItem
      key={`${sessionId}:${binding?.appOpenSessionId ?? ""}`}
      sessionId={sessionId}
      appOpenSessionId={binding?.appOpenSessionId ?? null}
      onCloseMenu={onClose}
    />
  );
}
