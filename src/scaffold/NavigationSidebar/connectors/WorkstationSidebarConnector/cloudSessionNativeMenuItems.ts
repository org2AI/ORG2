import {
  AppWindowMacIcon,
  ArrowBigRightDashIcon,
  ChangeScreenModeIcon,
  Copy01Icon,
  CursorInWindowIcon,
  Delete02Icon,
  PinIcon,
  PinOffIcon,
} from "@src/icons";
import type { SidebarMenuItem } from "@src/scaffold/NavigationSidebar/menus/types";

interface BuildCloudSessionNativeMenuItemsParams {
  isPinned: boolean;
  labels: {
    openIn: string;
    openInNewTab: string;
    openInNewWindow: string;
    openInMyStation: string;
    copyUrl: string;
    togglePin: string;
    remove: string;
  };
  onOpenInNewTab: () => void;
  onOpenInNewWindow: () => void;
  onOpenInMyStation: () => void;
  onCopyUrl: () => void;
  onTogglePin: () => void;
  onRemove: () => void;
}

/**
 * The canonical sidebar menu for an actionable Team Conversation row.
 * Both secondary-click and the trailing ellipsis consume this exact list.
 */
export function buildCloudSessionNativeMenuItems({
  labels,
  isPinned,
  onOpenInNewTab,
  onOpenInNewWindow,
  onOpenInMyStation,
  onCopyUrl,
  onTogglePin,
  onRemove,
}: BuildCloudSessionNativeMenuItemsParams): SidebarMenuItem[] {
  return [
    {
      text: labels.openIn,
      icon: CursorInWindowIcon,
      items: [
        {
          text: labels.openInNewTab,
          icon: AppWindowMacIcon,
          action: onOpenInNewTab,
        },
        {
          text: labels.openInNewWindow,
          icon: ChangeScreenModeIcon,
          action: onOpenInNewWindow,
        },
        {
          text: labels.openInMyStation,
          icon: ArrowBigRightDashIcon,
          action: onOpenInMyStation,
        },
      ],
    },
    { text: labels.copyUrl, icon: Copy01Icon, action: onCopyUrl },
    {
      text: labels.togglePin,
      icon: isPinned ? PinOffIcon : PinIcon,
      action: onTogglePin,
    },
    { item: "Separator" },
    { text: labels.remove, icon: Delete02Icon, action: onRemove },
  ];
}
