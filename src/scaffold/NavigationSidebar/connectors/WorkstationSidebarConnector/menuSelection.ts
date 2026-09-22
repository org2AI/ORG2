import type { ChatPanelTabType } from "@src/store/chatPanel/chatPanelTabsModel";
import type { SessionCreatorDraft } from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
} from "@src/store/ui/chatPanel/selectionAtoms";

import {
  KANBAN_MENU_ITEM_ID,
  RUNTIME_MENU_ITEM_ID,
} from "../sidebarConnectorUtils";
import {
  getSelectedDraftMenuItemId,
  getSelectedMenuItemId,
} from "../workstationSidebarData";

interface ResolveSelectedMenuItemIdParams {
  activeSessionCreatorDraftId: string | null | undefined;
  activeSessionId: string;
  activeChatPanelTabType: ChatPanelTabType | null;
  chatPanelContentMode: ChatPanelContentMode;
  chatPanelCreateTarget: ChatPanelCreateTarget;
  chatPanelSelectedProject: ChatPanelSelectedProject | null;
  chatPanelSelectedWorkItem: ChatPanelSelectedWorkItem | null;
  sessionCreatorDrafts: readonly SessionCreatorDraft[];
}

export function resolveSessionSidebarMenuItemId({
  activeSessionCreatorDraftId,
  activeSessionId,
  activeChatPanelTabType,
  chatPanelContentMode,
  chatPanelCreateTarget,
  chatPanelSelectedProject,
  chatPanelSelectedWorkItem,
  sessionCreatorDrafts,
}: ResolveSelectedMenuItemIdParams): string {
  const selectedDraftMenuItemId = getSelectedDraftMenuItemId(
    activeSessionCreatorDraftId ?? null,
    sessionCreatorDrafts
  );
  const selectedPinnedMenuItemId =
    activeChatPanelTabType === "work-management"
      ? KANBAN_MENU_ITEM_ID
      : activeChatPanelTabType === "runtime"
        ? RUNTIME_MENU_ITEM_ID
        : "";
  const isChatPanelProjectsContentSelected =
    chatPanelContentMode === CHAT_PANEL_CONTENT_MODE.NON_SESSION ||
    Boolean(chatPanelSelectedWorkItem) ||
    Boolean(chatPanelSelectedProject);
  const sessionSelectedMenuItemId =
    chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.PROJECT ||
    chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM ||
    isChatPanelProjectsContentSelected
      ? ""
      : getSelectedMenuItemId({
          selectedPinnedMenuItemId,
          activeSessionId,
          selectedDraftMenuItemId,
        });
  return sessionSelectedMenuItemId;
}
