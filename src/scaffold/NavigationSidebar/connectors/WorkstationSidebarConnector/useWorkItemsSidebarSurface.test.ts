// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { CHAT_PANEL_CREATE_TARGET } from "@src/store/ui/chatPanel/selectionAtoms";

import { PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID } from "../sidebarConnectorUtils";
import * as ids from "../useProjectsWorkItemMenuItems/idHelpers";
import type { UseProjectsWorkItemMenuItemsParams } from "../useProjectsWorkItemMenuItems/types";
import { useWorkItemsSidebarSurface } from "./useWorkItemsSidebarSurface";

const mocks = vi.hoisted(() => ({
  model: vi.fn(),
  openProject: vi.fn(),
  openCreator: vi.fn(),
  mounted: vi.fn(),
  unmounted: vi.fn(),
}));
vi.mock("../useProjectsWorkItemMenuItems/index", async () => ({
  ...(await import("../useProjectsWorkItemMenuItems/idHelpers")),
  useProjectsWorkItemMenuItems: (
    params: UseProjectsWorkItemMenuItemsParams
  ) => {
    useEffect(() => {
      mocks.mounted();
      return () => mocks.unmounted();
    }, []);
    return mocks.model(params);
  },
}));
vi.mock("@src/store/chatPanel/chatPanelTabsAtom", async () => {
  const { atom } = await import("jotai");
  return {
    openProjectInChatPanelTabAtom: atom(null, (_get, _set, value: unknown) =>
      mocks.openProject(value)
    ),
    openChatPanelCreateTargetAtom: atom(null, (_get, _set, value: unknown) =>
      mocks.openCreator(value)
    ),
  };
});

const row = (id: string, label = id): NavigationMenuItem => ({
  id,
  key: id,
  label,
});
const project = { slug: "project-a" };
const projectRowId = ids.getProjectOverviewMenuItemId("project-a");
const menuItems = [row("separator-projects"), row(projectRowId, "Project A")];

describe("persistent work-item sidebar surface", () => {
  let root: Root;
  let container: HTMLDivElement;
  let surface: ReturnType<typeof useWorkItemsSidebarSurface>;
  const activateDetail = vi.fn();

  function Probe({ enabled, orgId }: { enabled: boolean; orgId: string }) {
    const value = useWorkItemsSidebarSurface({
      enabled,
      activeProjectOrgId: orgId,
      activateMyStationRouteForProjectTabContent: activateDetail,
    });
    useEffect(() => {
      surface = value;
    });
    return null;
  }
  const render = (enabled = true, orgId = "org-a") =>
    act(() => root.render(createElement(Probe, { enabled, orgId })));
  const click = (item: NavigationMenuItem) =>
    act(() => surface.onMenuItemClick(item.key, item));
  const latestQuery = () =>
    mocks.model.mock.lastCall![0] as UseProjectsWorkItemMenuItemsParams;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    mocks.model.mockReturnValue({
      menuItems,
      loading: false,
      projectMap: new Map([["project-a", project]]),
      toChatPanelProject: () => ({ slug: "project-a", name: "Project A" }),
    });
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("retains selection and collapse state across view and scope switches", () => {
    render();
    click(row(projectRowId));
    expect(surface.menuItems).toBe(menuItems);
    act(() => surface.onCollapsedSectionIdsChange(new Set(["projects"])));
    render(false, "org-b");
    expect(latestQuery()).toMatchObject({
      enabled: false,
      selectedOrgId: "org-b",
      searchQuery: "",
    });
    expect(surface.selectedMenuItemId).toBe(projectRowId);
    expect(surface.collapsedSectionIds).toEqual(new Set(["projects"]));
    render(true);
    expect(mocks.mounted).toHaveBeenCalledTimes(1);
    expect(mocks.unmounted).not.toHaveBeenCalled();
  });

  it("opens project rows through the project tab owner", () => {
    render();
    click(row(projectRowId));
    expect(mocks.openProject).toHaveBeenCalledWith({
      slug: "project-a",
      name: "Project A",
    });
    expect(activateDetail).toHaveBeenCalledTimes(1);
    click(row(ids.getProjectOverviewMenuItemId("missing")));
    expect(mocks.openProject).toHaveBeenCalledTimes(1);
  });

  it("opens the work-item creator without changing the selection", () => {
    render();
    click(row(PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID));
    expect(mocks.openCreator).toHaveBeenCalledWith({
      target: CHAT_PANEL_CREATE_TARGET.WORK_ITEM,
    });
    expect(activateDetail).not.toHaveBeenCalled();
    expect(surface.selectedMenuItemId).toBe("");
  });
});
