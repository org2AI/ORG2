import React from "react";

import { ChatBubbleBody } from "@src/components/ChatBubble";

import PortableUserMessageContent from "./PortableUserMessageContent";

export interface UserBubbleProps {
  text: string;
  children?: React.ReactNode;
}

export function UserBubble({ text, children }: UserBubbleProps) {
  return (
    <div className="flex justify-end">
      <ChatBubbleBody
        variant="sessionUser"
        className="!max-w-[85%]"
        bodyClassName="mobile-type-body"
      >
        <PortableUserMessageContent text={text} />
        {children}
      </ChatBubbleBody>
    </div>
  );
}

UserBubble.displayName = "UserBubble";
