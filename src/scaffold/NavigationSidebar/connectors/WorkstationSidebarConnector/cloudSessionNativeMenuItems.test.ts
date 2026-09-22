import { describe, expect, it, vi } from "vitest";

import { buildCloudSessionNativeMenuItems } from "./cloudSessionNativeMenuItems";

describe("buildCloudSessionNativeMenuItems", () => {
  it("keeps secondary-click and ellipsis destination actions in the canonical team menu", () => {
    const onOpenInNewTab = vi.fn();
    const onOpenInNewWindow = vi.fn();
    const onOpenInMyStation = vi.fn();
    const onCopyUrl = vi.fn();
    const onFork = vi.fn();
    const onTogglePin = vi.fn();
    const onRemove = vi.fn();

    const items = buildCloudSessionNativeMenuItems({
      isPinned: false,
      labels: {
        openIn: "Open in",
        fork: "Take over",
        openInNewTab: "Open in New Tab",
        openInNewWindow: "Open in New Window",
        openInMyStation: "Open in My Station",
        copyUrl: "Copy URL",
        togglePin: "Pin",
        remove: "Remove",
      },
      onOpenInNewTab,
      onOpenInNewWindow,
      onOpenInMyStation,
      onCopyUrl,
      onFork,
      onTogglePin,
      onRemove,
    });

    expect(
      items.map((item) => ("item" in item ? item.item : item.text))
    ).toEqual([
      "Open in",
      "Take over",
      "Copy URL",
      "Pin",
      "Separator",
      "Remove",
    ]);

    const submenu = items[0];
    if (!("items" in submenu)) throw new Error("Missing Open in submenu");
    const destinations =
      submenu.items as import("@src/scaffold/NavigationSidebar/menus/types").SidebarMenuItem[];
    expect(
      destinations.map((item) => ("text" in item ? item.text : ""))
    ).toEqual(["Open in New Tab", "Open in New Window", "Open in My Station"]);
    for (const item of [...destinations, ...items]) {
      if ("action" in item) item.action?.("test-menu-item");
    }
    expect(onOpenInNewTab).toHaveBeenCalledOnce();
    expect(onOpenInNewWindow).toHaveBeenCalledOnce();
    expect(onOpenInMyStation).toHaveBeenCalledOnce();
    expect(onCopyUrl).toHaveBeenCalledOnce();
    expect(onFork).toHaveBeenCalledOnce();
    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
