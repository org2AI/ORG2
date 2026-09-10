import { createContext, useContext } from "react";

import type { ChatHistoryDisplayMode } from "@src/store/ui/chatPanel/displayPrefsAtoms";

const ChatHistoryDisplayModeContext =
  createContext<ChatHistoryDisplayMode>("full");

export function useChatHistoryDisplayMode(): ChatHistoryDisplayMode {
  return useContext(ChatHistoryDisplayModeContext);
}

export const ChatHistoryDisplayModeProvider =
  ChatHistoryDisplayModeContext.Provider;
