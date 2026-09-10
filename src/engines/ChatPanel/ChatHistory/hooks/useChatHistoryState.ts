/**
 * Chat History State Hook
 *
 * Extracts all state management logic from ChatHistory component.
 * Manages:
 * - Chat history data from context
 * - virtual list ref for scroll control
 * - Scroll state (atBottom)
 * - Visible range tracking
 * - Chat appearance settings
 */
import { useAtomValue } from "jotai";
import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";

import {
  useChatHistory,
  useChatHistoryActions,
} from "@src/contexts/workspace/ChatContext";
import type { SessionTranscriptPlatformState } from "@src/engines/ChatPanel/runtime/sessionTranscriptPlatform.types";
import type { SessionLoadStatus } from "@src/engines/SessionCore";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  chatCodeFontSizeAtom,
  chatFontSizeAtom,
  chatLineHeightAtom,
} from "@src/store/config/configAtom";

import type { ChatHistoryListHandle } from "../components/ChatHistoryList";

// ============================================
// Props Interface
// ============================================

export interface UseChatHistoryStateProps {
  platform: SessionTranscriptPlatformState;
}

// ============================================
// Return Type
// ============================================

export interface UseChatHistoryStateReturn {
  // Chat data (raw events from chatEventsAtom — pipeline creates OptimizedChatItem[])
  chatHistory: SessionEvent[];
  chatHistorySourceIsOverride: boolean;
  chatHistorySourceSessionId: string | null;
  chatHistorySourceVersion: number;

  // Refs
  chatContainerRef: RefObject<HTMLDivElement | null>;
  virtualListRef: RefObject<ChatHistoryListHandle | null>;
  isWpGeneWorkingRef: MutableRefObject<boolean>;

  // Scroll state
  atBottom: boolean;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  visibleRange: { startIndex: number; endIndex: number };
  setVisibleRange: Dispatch<
    SetStateAction<{ startIndex: number; endIndex: number }>
  >;

  // Appearance (focused atoms — only layout props, not animation settings)
  chatFontSize: number;
  chatCodeFontSize: number;
  chatLineHeight: number;

  // Session loading
  sessionLoadStatus: SessionLoadStatus;
  sessionLoadError: string | null;

  // Callbacks from context
  setIsChatScrolledToBottom: (bottom: boolean) => void;
}

// ============================================
// Hook
// ============================================

export function useChatHistoryState({
  platform,
}: UseChatHistoryStateProps): UseChatHistoryStateReturn {
  // ============================================
  // Context & Atoms
  // ============================================

  const {
    chatHistory,
    sourceIsOverride: chatHistorySourceIsOverride,
    sourceSessionId: chatHistorySourceSessionId,
    sourceVersion: chatHistorySourceVersion,
  } = useChatHistory();
  const { setIsChatScrolledToBottom, chatContainerRef } =
    useChatHistoryActions();

  const chatFontSize = useAtomValue(chatFontSizeAtom);
  const chatCodeFontSize = useAtomValue(chatCodeFontSizeAtom);
  const chatLineHeight = useAtomValue(chatLineHeightAtom);

  // ============================================
  // Local State
  // ============================================

  const virtualListRef = useRef<ChatHistoryListHandle>(null);

  // Track whether should auto-scroll to bottom
  const [atBottom, setAtBottom] = useState(true);

  // Track current visible range (for pinned question auto-adaptation)
  const [visibleRange, setVisibleRange] = useState({
    startIndex: 0,
    endIndex: 0,
  });

  // ============================================
  // Return
  // ============================================

  return {
    chatHistory,
    chatHistorySourceIsOverride,
    chatHistorySourceSessionId,
    chatHistorySourceVersion,

    // Refs
    chatContainerRef,
    virtualListRef,
    isWpGeneWorkingRef: platform.isAgentWorkingRef,

    // Scroll state
    atBottom,
    setAtBottom,
    visibleRange,
    setVisibleRange,

    // Appearance (focused atoms)
    chatFontSize,
    chatCodeFontSize,
    chatLineHeight,

    // Session loading
    sessionLoadStatus: platform.loadStatus,
    sessionLoadError: platform.loadError,

    // Callbacks from context
    setIsChatScrolledToBottom,
  };
}
