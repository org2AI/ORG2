import { type MouseEvent, useCallback } from "react";

import { dismissHoverCard } from "@src/components/HoverCard/singletonStore";
import { createLogger } from "@src/hooks/logger";
import {
  AppWindowMacIcon,
  ArrowBigRightDashIcon,
  CloudIcon,
  Copy01Icon,
  CursorInWindowIcon,
  Delete02Icon,
  FolderOutputIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  Share02Icon,
  Tag01Icon,
} from "@src/icons";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { popupSidebarMenu } from "@src/scaffold/NavigationSidebar/menus/SidebarMenu";
import { type SidebarMenuItem } from "@src/scaffold/NavigationSidebar/menus/types";
import type { Session } from "@src/store/session";
import {
  isCursorIdeSession,
  isHumanSession,
} from "@src/util/session/sessionDispatch";
import { isChatPanelTuiSessionId } from "@src/util/ui/terminal/chatPanelTuiSessionId";

import {
  getDraftIdFromMenuItemId,
  isDraftMenuItemId,
} from "./sidebarConnectorUtils";
import type { UseRenameSessionModalResult } from "./useRenameSessionModal";

const log = createLogger("WorkstationSidebar");

interface UseWorkstationSidebarContextMenuParams {
  sectionMenuItems?: (sessionId: string) => SidebarMenuItem[];
  sessionMap: Map<string, Session>;
  rename: UseRenameSessionModalResult;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleDeleteDraft: (draftId: string) => void;
  handleOpenDraftInNewTab: (item: NavigationMenuItem) => void;
  handleExportMarkdown: (sessionId: string) => Promise<void>;
  handleOpenInNewTab: (sessionId: string) => void;
  handleOpenInNewWindow: (sessionId: string) => void;
  handleOpenInMyStation: (sessionId: string) => void;
  handleTogglePin: (sessionId: string) => Promise<void>;
  /** Owner-side share dialog gate + opener (design §6.3, M4b). */
  /** Move-to-cloud-org (session→org tag) gate + opener. */
  isMoveEligible: (session: Session) => boolean;
  handleOpenMoveToOrg: (session: Session) => void;
  moveToOrgLabel: string;
  /** Per-session cloud access ladder (§13.4) gate + opener. */
  isCloudSyncLevelEligible: (session: Session) => boolean;
  handleOpenCloudSyncLevel: (session: Session) => void;
  cloudSyncLevelLabel: string;
  /** Cloud per-session shares (0012) gate + opener. */
  isCloudShareEligible: (session: Session) => boolean;
  handleOpenCloudShare: (session: Session) => void;
  cloudShareLabel: string;
  /**
   * Copy a non-secret session reference. Gated on the session actually
   * being published to a cloud org: a reference for an org it was never
   * pushed to resolves for nobody, and the paste looks fine either way.
   */
  isCopyReferenceEligible: (session: Session) => boolean;
  handleCopyReference: (session: Session) => void;
  copyReferenceLabel: string;
  /** Team rows have no local Session and provide their own canonical menu. */
  buildCloudRemoteItemMenuItems?: (
    item: NavigationMenuItem
  ) => SidebarMenuItem[];
  tCommon: (key: string) => string;
}

export function useWorkstationSidebarContextMenu({
  sessionMap,
  sectionMenuItems,
  rename,
  handleDeleteSession,
  handleDeleteDraft,
  handleOpenDraftInNewTab,
  handleExportMarkdown,
  handleOpenInNewTab,
  handleOpenInNewWindow,
  handleOpenInMyStation,
  handleTogglePin,
  isMoveEligible,
  handleOpenMoveToOrg,
  moveToOrgLabel,
  isCloudSyncLevelEligible,
  handleOpenCloudSyncLevel,
  cloudSyncLevelLabel,
  isCloudShareEligible,
  handleOpenCloudShare,
  cloudShareLabel,
  isCopyReferenceEligible,
  handleCopyReference,
  copyReferenceLabel,
  buildCloudRemoteItemMenuItems,
  tCommon,
}: UseWorkstationSidebarContextMenuParams): (
  event: MouseEvent,
  _key: string,
  item: NavigationMenuItem
) => Promise<void> {
  const buildMenuItems = useCallback(
    (_key: string, item: NavigationMenuItem): SidebarMenuItem[] => {
      if (isDraftMenuItemId(item.id)) {
        const draftId = getDraftIdFromMenuItemId(item.id);
        if (!draftId) return [];
        return [
          {
            text: tCommon("actions.openIn"),
            icon: CursorInWindowIcon,
            items: [
              {
                text: tCommon("actions.openInNewTab"),
                icon: AppWindowMacIcon,
                action: () => handleOpenDraftInNewTab(item),
              },
            ],
          },
          {
            text: tCommon("sessions:kanban.sidebar.removeDraft"),
            danger: true,
            icon: Delete02Icon,
            action: () => handleDeleteDraft(draftId),
          },
        ];
      }

      if (!sessionMap.has(item.id)) {
        return buildCloudRemoteItemMenuItems?.(item) ?? [];
      }

      const isCursorIde = isCursorIdeSession(item.id);
      const session = sessionMap.get(item.id);

      // Subagent rows have no meaningful row-level actions.
      if (session?.parentSessionId || item.id.includes(":subagent:")) return [];

      const openInNewTabItem: SidebarMenuItem = {
        text: tCommon("actions.openInNewTab"),
        icon: AppWindowMacIcon,
        action: () => handleOpenInNewTab(item.id),
      };
      const openInNewWindowItem: SidebarMenuItem = {
        text: tCommon("actions.openInNewWindow"),
        icon: AppWindowMacIcon,
        action: () => handleOpenInNewWindow(item.id),
      };
      const openInMyStationItem: SidebarMenuItem = {
        text: tCommon("sessions:controlTower.sidebar.openInMyStation"),
        icon: ArrowBigRightDashIcon,
        action: () => handleOpenInMyStation(item.id),
      };
      const openInMenu = (items: SidebarMenuItem[]): SidebarMenuItem => ({
        text: tCommon("actions.openIn"),
        icon: CursorInWindowIcon,
        appOpenSessionId: item.id,
        items,
      });
      const pinItem: SidebarMenuItem = {
        icon: session?.pinned ? PinOffIcon : PinIcon,
        text: session?.pinned
          ? tCommon("sessions:chat.unpinSession")
          : tCommon("sessions:chat.pinSession"),
        action: () => handleTogglePin(item.id),
      };

      if (isCursorIde) {
        return [
          openInMenu([
            openInNewTabItem,
            openInNewWindowItem,
            openInMyStationItem,
          ]),
          pinItem,
          ...(sectionMenuItems?.(item.id) ?? []),
        ];
      }

      const deleteItem: SidebarMenuItem = {
        text: tCommon("actions.delete"),
        danger: true,
        icon: Delete02Icon,
        action: () => handleDeleteSession(item.id),
      };
      if (isChatPanelTuiSessionId(item.id)) {
        return [
          openInMenu([openInNewTabItem, openInNewWindowItem]),
          pinItem,
          deleteItem,
        ];
      }

      const primaryItems: SidebarMenuItem[] = [
        openInMenu([
          openInNewTabItem,
          openInNewWindowItem,
          openInMyStationItem,
        ]),
        {
          text: tCommon("actions.rename"),
          icon: PencilEdit02Icon,
          action: () => rename.open(item.id, sessionMap),
        },
      ];
      const exportItems: SidebarMenuItem[] = [];
      const syncItems: SidebarMenuItem[] = [];
      if (!isHumanSession(item.id)) {
        exportItems.push({
          text: tCommon("sessions:chat.exportAsMarkdown"),
          icon: FolderOutputIcon,
          action: () => handleExportMarkdown(item.id),
        });
      }
      // Move (tag) the session into a managed cloud org, independent of
      // repo-scope auto-sharing. Owner's own pushable sessions only.
      if (session && isMoveEligible(session)) {
        syncItems.push({
          text: moveToOrgLabel,
          icon: Tag01Icon,
          action: () => handleOpenMoveToOrg(session),
        });
      }
      // Per-session cloud access ladder (§13.4): Off / Metadata only /
      // Full replay + org/restricted visibility, per cloud org.
      if (session && isCloudSyncLevelEligible(session)) {
        syncItems.push({
          text: cloudSyncLevelLabel,
          icon: CloudIcon,
          action: () => handleOpenCloudSyncLevel(session),
        });
      }
      // Cloud per-session shares (0012): directed member grants + guest
      // link shares, for the owner's own cloud-synced sessions.
      if (session && isCloudShareEligible(session)) {
        syncItems.push({
          text: cloudShareLabel,
          icon: Share02Icon,
          action: () => handleOpenCloudShare(session),
        });
      }
      // Non-secret reference for issue trackers and PRs. Export is available
      // only when the session already has a shareable reference.
      if (session && isCopyReferenceEligible(session)) {
        exportItems.push({
          text: copyReferenceLabel,
          icon: Copy01Icon,
          action: () => handleCopyReference(session),
        });
      }

      const transferSections: SidebarMenuItem[] = [];
      if (exportItems.length > 0) {
        transferSections.push({
          text: tCommon("actions.export"),
          section: true,
          items: exportItems,
        });
      }
      if (syncItems.length > 0) {
        if (transferSections.length)
          transferSections.push({ item: "Separator" });
        transferSections.push({
          text: tCommon("actions.sync"),
          section: true,
          items: syncItems,
        });
      }
      if (transferSections.length > 0) {
        primaryItems.push({
          text: tCommon("actions.exportAndSync"),
          icon: FolderOutputIcon,
          items: transferSections,
        });
      }

      // Team roots use the explicit Archived Overview Danger Zone. Generic
      // Session Delete is intentionally absent so it cannot bypass Archive or
      // the quiesced-runtime receipt.
      if (session?.agentOrgId) {
        return [
          ...primaryItems,
          pinItem,
          ...(sectionMenuItems?.(item.id) ?? []),
        ];
      }
      return [
        ...primaryItems,
        pinItem,
        ...(sectionMenuItems?.(item.id) ?? []),
        { item: "Separator" },
        deleteItem,
      ];
    },
    [
      sessionMap,
      sectionMenuItems,
      tCommon,
      rename,
      handleDeleteSession,
      handleDeleteDraft,
      handleOpenDraftInNewTab,
      handleExportMarkdown,
      handleOpenInNewTab,
      handleOpenInNewWindow,
      handleOpenInMyStation,
      handleTogglePin,
      handleOpenMoveToOrg,
      isMoveEligible,
      moveToOrgLabel,
      handleOpenCloudSyncLevel,
      isCloudSyncLevelEligible,
      cloudSyncLevelLabel,
      handleOpenCloudShare,
      isCloudShareEligible,
      cloudShareLabel,
      handleCopyReference,
      isCopyReferenceEligible,
      copyReferenceLabel,
      buildCloudRemoteItemMenuItems,
    ]
  );

  return useCallback(
    async (event: MouseEvent, key: string, item: NavigationMenuItem) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        dismissHoverCard();
        await popupSidebarMenu(event, {
          source: "workstation-sidebar-row",
          buildItems: () => buildMenuItems(key, item),
        });
      } catch (error) {
        log.error("[WorkstationSidebar] Context menu failed:", error);
      }
    },
    [buildMenuItems]
  );
}
