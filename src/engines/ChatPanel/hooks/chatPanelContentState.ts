import type { ChatPanelSurfaceState } from "@src/store/ui/chatPanel/surfaceAtoms";
import { CHAT_PANEL_SURFACE_KIND } from "@src/types/ui/chatPanel";

interface ChatPanelContentStateOptions {
  currentSessionId: string | null;
  surface: ChatPanelSurfaceState;
}

export interface ChatPanelContentState {
  showSessionContent: boolean;
}

export function resolveChatPanelContentState({
  currentSessionId,
  surface,
}: ChatPanelContentStateOptions): ChatPanelContentState {
  return {
    showSessionContent:
      surface.kind === CHAT_PANEL_SURFACE_KIND.SESSION &&
      Boolean(currentSessionId),
  };
}
