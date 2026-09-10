import { describe, expect, it } from "vitest";

import {
  hasSidebarMenuRows,
  resolveSidebarSelectedMenuItemId,
} from "./sidebarConnector.bottomActions";

describe("resolveSidebarSelectedMenuItemId", () => {
  it("keeps the Work Items destination highlighted over a stale session scope", () => {
    expect(
      resolveSidebarSelectedMenuItemId({
        activeViewKey: "work-items",
        selectedCloudMenuItemId: "cloud-session-1",
        selectedMenuItemId: "work-items",
      })
    ).toBe("work-items");
  });

  it("keeps the scoped session highlighted in the sessions view", () => {
    expect(
      resolveSidebarSelectedMenuItemId({
        activeViewKey: "sessions",
        selectedCloudMenuItemId: "cloud-session-1",
        selectedMenuItemId: "session-1",
      })
    ).toBe("cloud-session-1");
  });
});

describe("hasSidebarMenuRows", () => {
  it("treats an initial section header as empty so the skeleton can render", () => {
    expect(
      hasSidebarMenuRows([
        {
          id: "separator-recent-projects",
          key: "separator-recent-projects",
          label: "Recent projects",
        },
      ])
    ).toBe(false);
  });

  it("keeps loaded rows visible during a background refresh", () => {
    expect(
      hasSidebarMenuRows([
        {
          id: "separator-work-items",
          key: "separator-work-items",
          label: "Work Items",
        },
        { id: "work-item-1", key: "work-item-1", label: "Fix sidebar" },
      ])
    ).toBe(true);
  });
});
