import React, { Suspense, lazy } from "react";

import ChatLoadingBlock from "../blocks/primitives/ChatLoadingBlock";
import type { ChatHistoryProps } from "./ChatHistory.types";

export type { ScrollNavState } from "./ChatHistory.types";

// Share one loading boundary across main chat, side chat and embedded readers.
// Importing the entry must not load the transcript projection/rendering graph.
const ChatHistory = lazy(() => import("./ChatHistory"));

export default function LazyChatHistory(props: ChatHistoryProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-0 flex-1 justify-center p-4">
          <ChatLoadingBlock />
        </div>
      }
    >
      <ChatHistory {...props} />
    </Suspense>
  );
}
