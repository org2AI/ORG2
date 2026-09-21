import React from "react";

import { ChatAssistantMessageBody } from "@src/components/ChatBubble";

import PortableAgentMessageContent from "./PortableAgentMessageContent";

export interface AgentBubbleProps {
  text: string;
  streaming?: boolean;
  children?: React.ReactNode;
}

export function AgentBubble({ text, streaming, children }: AgentBubbleProps) {
  return (
    <ChatAssistantMessageBody
      testId="mobile-agent-message"
      className="text-left"
    >
      <PortableAgentMessageContent text={text} streaming={streaming} />
      {children}
      {streaming ? <span className="ml-1 animate-pulse">▍</span> : null}
    </ChatAssistantMessageBody>
  );
}

AgentBubble.displayName = "AgentBubble";
