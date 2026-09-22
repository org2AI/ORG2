import {
  AppWindowMacIcon,
  ArrowBigRightDashIcon,
  Copy01Icon,
  CursorInWindowIcon,
  Delete02Icon,
  Login02Icon,
  PinIcon,
  PinOffIcon,
} from "@src/icons";
import type { SidebarMenuItem } from "@src/scaffold/NavigationSidebar/menus/types";

interface BuildCloudSessionNativeMenuItemsParams {
  isPinned: boolean;
  labels: {
    openIn: string;
    fork: string;
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
  onFork: () => void;
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
  onFork,
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
          icon: AppWindowMacIcon,
          action: onOpenInNewWindow,
        },
        {
          text: labels.openInMyStation,
          icon: ArrowBigRightDashIcon,
          action: onOpenInMyStation,
        },
      ],
    },
    { text: labels.fork, icon: Login02Icon, action: onFork },
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
