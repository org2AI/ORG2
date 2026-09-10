import type { TFunction } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { openAgentSessionSearchSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";

import { useCloudTeamSessionMenuItems } from "./cloudSessionsSection.menuItems";

vi.mock("@src/scaffold/GlobalSpotlight/openSpotlight", () => ({
  openAgentSessionSearchSpotlight: vi.fn(),
}));

describe("cloud Team Sessions header", () => {
  it("orders pane-hover actions as search, refresh, filter even with no sessions", () => {
    const refresh = vi.fn();
    function Harness() {
      const items = useCloudTeamSessionMenuItems({
        orgId: "org-1",
        threads: [],
        visibleThreads: [],
        state: "ready",
        filter: { kind: "all" },
        memberMenu: null,
        setMemberMenu: vi.fn(),
        refreshSpinClass: undefined,
        handleRefreshClick: refresh,
        buildRowItem: vi.fn(),
        t: ((key: string) => key) as TFunction,
        tCommon: ((key: string) => key) as TFunction,
      });
      const actions = items[0].rowActions!;
      expect(actions.map((action) => action.dataTestId)).toEqual([
        "cloud-team-sessions-search",
        "cloud-team-sessions-refresh",
        "cloud-team-sessions-filter",
      ]);
      expect(actions.every((action) => action.showOnSidebarHover)).toBe(true);
      expect(actions[0].onClick).toBe(openAgentSessionSearchSpotlight);
      expect(actions[1].onClick).toBe(refresh);
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
  });
});
