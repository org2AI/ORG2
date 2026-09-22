import { type PrimitiveAtom, atom, useAtomValue, useSetAtom } from "jotai";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import type { TabDragEventDetail } from "@src/modules/WorkStation/shared/TabBar/tabDragTypes";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Session } from "@src/store/session";
import { isChatPanelTuiSessionId } from "@src/util/ui/terminal/chatPanelTuiSessionId";

import { sidebarGroupByAtom } from "../sidebarGroupByAtom";
import {
  reorderSessionIds,
  sidebarSessionOrderAtom,
  sidebarSessionSortAtom,
} from "../sidebarSessionOrder";

interface DropTarget {
  id: string;
  after: boolean;
  pinned: boolean;
  sectionId?: string;
  top: number;
  left: number;
  width: number;
}

export function useSessionSidebarOrdering({
  enabled,
  items,
  sessionMap,
  onTogglePin,
  onMoveToSection,
  sectionMembership,
}: {
  enabled: boolean;
  items: readonly NavigationMenuItem[];
  sessionMap: ReadonlyMap<string, Session>;
  onTogglePin: (id: string) => Promise<void>;
  onMoveToSection?: (id: string, sectionId: string | null) => Promise<boolean>;
  sectionMembership?: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation("navigation");
  const setOrder = useSetAtom(sidebarSessionOrderAtom);
  const order = useAtomValue(sidebarSessionOrderAtom);
  const setSort = useSetAtom(sidebarSessionSortAtom);
  const setGroup = useSetAtom(sidebarGroupByAtom);
  const unpinZoneRef = useRef<HTMLDivElement>(null);
  const [feedbackAtom] = useState(() =>
    atom<DragFeedback>({ dragging: false, target: null })
  );
  const setFeedback = useSetAtom(feedbackAtom);
  const latest = useRef({
    items,
    sessionMap,
    order,
    onTogglePin,
    onMoveToSection,
    sectionMembership,
  });
  useLayoutEffect(() => {
    latest.current = {
      items,
      sessionMap,
      order,
      onTogglePin,
      onMoveToSection,
      sectionMembership,
    };
  });
  const eligible = useCallback((id: string) => {
    const session = latest.current.sessionMap.get(id);
    return Boolean(
      session &&
      !session.parentSessionId &&
      !id.includes(":subagent:") &&
      !isChatPanelTuiSessionId(id)
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let source: string | null = null;
    const reset = () => {
      source = null;
      setFeedback({ dragging: false, target: null });
    };
    const hitTest = (x: number, y: number): DropTarget | null => {
      const zone = unpinZoneRef.current?.getBoundingClientRect();
      if (
        zone &&
        x >= zone.left &&
        x <= zone.right &&
        y >= zone.top &&
        y <= zone.bottom
      ) {
        return {
          id: "",
          pinned: false,
          after: true,
          top: zone.bottom,
          left: zone.left,
          width: zone.width,
        };
      }
      const element = document.elementFromPoint(x, y);
      const sectionHeader = element?.closest<HTMLElement>(
        "[data-sidebar-section-toggle]"
      );
      const sectionKey = sectionHeader?.dataset.sidebarSectionToggle;
      if (
        sectionHeader &&
        sectionKey?.startsWith("custom-section-") &&
        latest.current.onMoveToSection
      ) {
        const rect = sectionHeader.getBoundingClientRect();
        return {
          id: "",
          sectionId: sectionKey.slice("custom-section-".length),
          pinned: false,
          after: true,
          top: rect.bottom,
          left: rect.left,
          width: rect.width,
        };
      }
      const row = element?.closest<HTMLElement>("[data-sidebar-order-id]");
      const id = row?.dataset.sidebarOrderId;
      if (!row || !id || !eligible(id)) return null;
      const pinned = Boolean(latest.current.sessionMap.get(id)?.pinned);
      // Existing pins can be reordered, but dragging an unpinned row cannot pin it.
      if (pinned && (!source || !latest.current.sessionMap.get(source)?.pinned))
        return null;
      const rect = row.getBoundingClientRect();
      const after = y >= rect.top + rect.height / 2;
      return {
        id,
        after,
        pinned,
        top: after ? rect.bottom : rect.top,
        left: rect.left,
        width: rect.width,
      };
    };
    const start = (event: Event) => {
      const id = (event as CustomEvent<TabDragEventDetail>).detail.tabId;
      if (!eligible(id) || !latest.current.items.some((item) => item.id === id))
        return;
      source = id;
      setFeedback({ dragging: true, target: null });
    };
    const move = (event: PointerEvent) => {
      if (source)
        setFeedback({
          dragging: true,
          target: hitTest(event.clientX, event.clientY),
        });
    };
    const end = (event: Event) => {
      const id = source;
      const detail = (event as CustomEvent<TabDragEventDetail>).detail;
      const drop =
        id && detail.pointerX !== undefined && detail.pointerY !== undefined
          ? hitTest(detail.pointerX, detail.pointerY)
          : null;
      reset();
      if (!id || !drop || drop.id === id) return;
      const current = latest.current;
      if (!current.sessionMap.has(id)) return;
      const sourceSection = current.sectionMembership?.get(id) ?? null;
      const targetSection =
        !drop.id && !drop.sectionId
          ? sourceSection
          : (drop.sectionId ?? current.sectionMembership?.get(drop.id) ?? null);
      if (
        !drop.pinned &&
        current.onMoveToSection &&
        (sourceSection !== targetSection || drop.sectionId)
      ) {
        void current
          .onMoveToSection(id, targetSection)
          .then(async (success) => {
            if (success && current.sessionMap.get(id)?.pinned)
              await current.onTogglePin(id);
          })
          .catch((error) => Message.error(String(error)));
        return;
      }
      const visibleIds = current.items
        .filter((item) => eligible(item.id))
        .map((item) => item.id);
      const candidates = drop.pinned ? visibleIds : [...visibleIds].reverse();
      const anchor =
        drop.id ||
        candidates.find(
          (other) =>
            other !== id &&
            Boolean(current.sessionMap.get(other)?.pinned) === drop.pinned
        ) ||
        candidates.find((other) => other !== id);
      if (anchor)
        setOrder(
          reorderSessionIds(current.order, visibleIds, id, anchor, drop.after)
        );
      setSort("manual");
      // Cross-group placement has no meaning in time/workspace/agent groups.
      // Flatten only when moving between regular groups; never mutate domain metadata.
      const sectionOf = (rowId: string) => {
        let section = "";
        for (const item of current.items) {
          if (item.id.startsWith("separator-")) section = item.id;
          if (item.id === rowId) return section;
        }
        return section;
      };
      if (!drop.pinned && sectionOf(id) !== sectionOf(drop.id))
        setGroup("none");
      if (current.sessionMap.get(id)?.pinned && !drop.pinned)
        void current
          .onTogglePin(id)
          .catch((error) => Message.error(String(error)));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") reset();
    };
    document.addEventListener("tab-drag-start", start);
    document.addEventListener("tab-drag-end", end);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointercancel", reset, true);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", key);
    return () => {
      setFeedback({ dragging: false, target: null });
      document.removeEventListener("tab-drag-start", start);
      document.removeEventListener("tab-drag-end", end);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointercancel", reset, true);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", key);
    };
  }, [enabled, eligible, setGroup, setOrder, setSort, setFeedback]);

  const wrap = useCallback(
    (item: NavigationMenuItem, node: React.ReactElement) =>
      enabled &&
      sessionMap.has(item.id) &&
      !sessionMap.get(item.id)?.parentSessionId &&
      !item.id.includes(":subagent:") &&
      !isChatPanelTuiSessionId(item.id) ? (
        <div data-sidebar-order-id={item.id}>{node}</div>
      ) : (
        node
      ),
    [enabled, sessionMap]
  );

  return {
    wrap,
    unpinDropZone: enabled ? (
      <DropZone
        feedbackAtom={feedbackAtom}
        zoneRef={unpinZoneRef}
        label={t("sidebar.sort.dropToUnpin")}
        testId="sidebar-unpin-drop-zone"
      />
    ) : null,
    insertionLine: enabled ? (
      <InsertionLine feedbackAtom={feedbackAtom} />
    ) : null,
  };
}

interface DragFeedback {
  dragging: boolean;
  target: DropTarget | null;
}
function DropZone({
  feedbackAtom,
  zoneRef,
  label,
  testId,
}: {
  feedbackAtom: PrimitiveAtom<DragFeedback>;
  zoneRef: React.RefObject<HTMLDivElement | null>;
  label: string;
  testId: string;
}) {
  const { dragging } = useAtomValue(feedbackAtom);
  return dragging ? (
    <div
      ref={zoneRef}
      data-testid={testId}
      className="mx-3 rounded-md border border-dashed border-border-2 px-2 py-3 text-xs text-text-2"
    >
      {label}
    </div>
  ) : null;
}
function InsertionLine({
  feedbackAtom,
}: {
  feedbackAtom: PrimitiveAtom<DragFeedback>;
}) {
  const { target } = useAtomValue(feedbackAtom);
  return target
    ? createPortal(
        <div
          aria-hidden="true"
          data-testid="sidebar-session-insertion-line"
          className="pointer-events-none fixed z-50 h-0.5 rounded-full bg-primary-6"
          style={{
            top: target.top - 1,
            left: target.left,
            width: target.width,
          }}
        />,
        document.body
      )
    : null;
}
