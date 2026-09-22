// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { popupSidebarMenu } from "@src/scaffold/NavigationSidebar/menus/SidebarMenu";
import type { Session } from "@src/store/session";
import { testTranslate } from "@src/test/i18nTestTranslate";

import { useWorkstationSidebarContextMenu } from "../useWorkstationSidebarContextMenu";

vi.mock("@src/scaffold/NavigationSidebar/menus/SidebarMenu", () => ({
  popupSidebarMenu: vi.fn().mockResolvedValue({ status: "closed" }),
}));

const mockedPopupSidebarMenu = vi.mocked(popupSidebarMenu);
const translate = testTranslate;

function session(sessionId: string): Session {
  return {
    session_id: sessionId,
    name: `Session ${sessionId}`,
    status: "completed",
    created_at: "2026-09-03T00:00:00Z",
    updated_at: "2026-09-03T00:00:00Z",
  };
}

describe("useWorkstationSidebarContextMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockedPopupSidebarMenu.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each([false, true])(
    "preserves destinations and groups eligible export/sync actions (eligible=%s)",
    async (eligible) => {
      const sessions = [
        session("sdeagent-local"),
        session("cursoride-imported"),
        session("chatpaneltui-terminal"),
      ];
      const sessionMap = new Map(
        sessions.map((row) => [row.session_id, row] as const)
      );
      const handleOpenInNewWindow = vi.fn();
      const handleExportMarkdown = vi.fn();
      const handleOpenMoveToOrg = vi.fn();
      const handleOpenCloudSyncLevel = vi.fn();
      const handleOpenCloudShare = vi.fn();
      const handleCopyReference = vi.fn();
      let openMenu:
        | ReturnType<typeof useWorkstationSidebarContextMenu>
        | undefined;

      function Probe(): null {
        const value = useWorkstationSidebarContextMenu({
          sessionMap,
          rename: {
            visible: false,
            currentName: "",
            loading: false,
            open: vi.fn(),
            onConfirm: vi.fn(async () => undefined),
            onCancel: vi.fn(),
            renameSessionId: null,
          },
          handleDeleteSession: vi.fn(async () => undefined),
          handleDeleteDraft: vi.fn(),
          handleOpenDraftInNewTab: vi.fn(),
          handleExportMarkdown,
          handleOpenInNewTab: vi.fn(),
          handleOpenInNewWindow,
          handleOpenInMyStation: vi.fn(),
          handleTogglePin: vi.fn(async () => undefined),
          isMoveEligible: () => eligible,
          handleOpenMoveToOrg,
          moveToOrgLabel: "Move to organization",
          isCloudSyncLevelEligible: () => eligible,
          handleOpenCloudSyncLevel,
          cloudSyncLevelLabel: "Cloud sync",
          isCloudShareEligible: () => eligible,
          handleOpenCloudShare,
          cloudShareLabel: "Share",
          isCopyReferenceEligible: () => eligible,
          handleCopyReference,
          copyReferenceLabel: "Copy URL",
          tCommon: translate,
        });
        useEffect(() => {
          openMenu = value;
        }, [value]);
        return null;
      }

      await act(async () => root.render(createElement(Probe)));
      if (!openMenu) throw new Error("context menu hook did not render");

      for (const row of sessions) {
        const item: NavigationMenuItem = {
          id: row.session_id,
          key: row.session_id,
          label: row.name ?? row.session_id,
        };
        const event = {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as never;

        await openMenu(event, item.key, item);
        const popupOptions = mockedPopupSidebarMenu.mock.lastCall?.[1];
        const items = await popupOptions?.buildItems();
        const deleteItem = items?.find(
          (entry) =>
            "text" in entry &&
            entry.text === testTranslate("common:actions.delete")
        );
        if (row.session_id !== "cursoride-imported")
          expect(deleteItem).toMatchObject({ danger: true });
        const openInMenu = items?.find((entry) => "items" in entry);
        expect(openInMenu).toMatchObject({ appOpenSessionId: row.session_id });
        const destinations =
          openInMenu && "items" in openInMenu
            ? (openInMenu.items as import("@src/scaffold/NavigationSidebar/menus/types").SidebarMenuItem[])
            : [];
        const detachedWindowItem = destinations.find(
          (menuItem) =>
            "text" in menuItem &&
            menuItem.text === testTranslate("common:actions.openInNewWindow")
        );

        expect(detachedWindowItem).toBeDefined();
        if (detachedWindowItem && "action" in detachedWindowItem) {
          detachedWindowItem.action?.("open-in-new-window");
        }
        expect(handleOpenInNewWindow).toHaveBeenLastCalledWith(row.session_id);
        const submenuItems = (label: string) => {
          const combined = items?.find(
            (entry) =>
              "text" in entry &&
              entry.text === testTranslate("common:actions.exportAndSync")
          );
          const sections =
            combined && "items" in combined ? combined.items : [];
          const submenu = sections?.find(
            (entry) => "text" in entry && entry.text === label
          );
          if (submenu) expect(submenu).toMatchObject({ section: true });
          return submenu && "items" in submenu
            ? (submenu.items as import("@src/scaffold/NavigationSidebar/menus/types").SidebarMenuItem[])
            : [];
        };
        const exports = submenuItems(testTranslate("common:actions.export"));
        const sync = submenuItems(testTranslate("common:actions.sync"));
        if (row.session_id === "sdeagent-local") {
          expect(
            exports.map((entry) => ("text" in entry ? entry.text : ""))
          ).toEqual([
            testTranslate("sessions:chat.exportAsMarkdown"),
            ...(eligible ? ["Copy URL"] : []),
          ]);
          expect(
            sync.map((entry) => ("text" in entry ? entry.text : ""))
          ).toEqual(
            eligible ? ["Move to organization", "Cloud sync", "Share"] : []
          );
          for (const entry of [...exports, ...sync]) {
            if ("action" in entry) entry.action?.("test");
          }
          expect(handleExportMarkdown).toHaveBeenCalledExactlyOnceWith(
            row.session_id
          );
          for (const action of [
            handleOpenMoveToOrg,
            handleOpenCloudSyncLevel,
            handleOpenCloudShare,
            handleCopyReference,
          ]) {
            if (eligible) expect(action).toHaveBeenCalledExactlyOnceWith(row);
            else expect(action).not.toHaveBeenCalled();
          }
          expect(
            items?.some(
              (entry) =>
                "text" in entry &&
                entry.text === testTranslate("common:actions.sync")
            )
          ).toBe(false);
        } else {
          expect(exports).toEqual([]);
          expect(sync).toEqual([]);
        }
      }
    }
  );
});
