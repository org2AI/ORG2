import type { IconSvgElement } from "@src/icons";

/** App-rendered sidebar actions; icons are glyphs, never native-menu resources. */
export type SidebarMenuItem =
  | { item: "Separator" }
  | {
      id?: string;
      text: string;
      icon?: IconSvgElement;
      enabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      action?: (id: string) => void;
      items?: SidebarMenuItem[];
      /** Labelled inline group, not another flyout level. */
      section?: boolean;
      /** Canonical local conversation for native-app destinations in this submenu. */
      appOpenSessionId?: string;
    };
