import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { type WorkItemData, workItemDataToUI } from "@src/api/http/project";
import {
  openSessionInNewChatTabAtom,
  openWorkItemInChatPanelTabAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import type { ChatPanelSelectedWorkItem } from "@src/store/ui/chatPanel/selectionAtoms";

/** Opens linked sessions and family (parent/sub) items in chat panel tabs. */
export function useWorkItemPanelNavigation(
  selectedWorkItem: ChatPanelSelectedWorkItem
) {
  const openSessionTab = useSetAtom(openSessionInNewChatTabAtom);
  const handleOpenSession = useCallback(
    (sessionId: string) => {
      openSessionTab({ sessionId });
    },
    [openSessionTab]
  );

  const openWorkItemTab = useSetAtom(openWorkItemInChatPanelTabAtom);
  const handleOpenFamilyItem = useCallback(
    (item: WorkItemData) => {
      const selection = {
        workItem: workItemDataToUI(item, {
          labelMap: new Map(),
          memberMap: new Map(),
        }),
        projectId: selectedWorkItem.projectId,
        projectName: selectedWorkItem.projectName,
        projectSlug: selectedWorkItem.projectSlug,
        shortId: item.frontmatter.short_id,
        orgId: selectedWorkItem.orgId,
      };
      openWorkItemTab(selection);
    },
    [
      openWorkItemTab,
      selectedWorkItem.orgId,
      selectedWorkItem.projectId,
      selectedWorkItem.projectName,
      selectedWorkItem.projectSlug,
    ]
  );

  return { handleOpenSession, handleOpenFamilyItem };
}
