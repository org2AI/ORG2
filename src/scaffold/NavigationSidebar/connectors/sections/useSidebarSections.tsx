import { listen } from "@tauri-apps/api/event";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import type {
  SidebarSectionMutation,
  SidebarSections,
} from "@src/api/tauri/rpc/schemas/sessionAggregate";
import { toFrontendSession } from "@src/api/tauri/session";
import Input from "@src/components/Input";
import Message from "@src/components/Message";
import { MoreHorizontalIcon } from "@src/icons";
import Modal from "@src/scaffold/ModalSystem";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { sessionsAtom, upsertSession } from "@src/store/session";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import {
  type NativeMenuItemOptions,
  popupNativeMenu,
} from "@src/util/platform/tauri/nativeMenuPopup";

import { sectionGroupId } from "./projection";

export { sectionGroupId } from "./projection";

const EMPTY: SidebarSections = { sections: [], members: [] };

const pageItemId = (id: string) => `section-page-${id}`;
type Page = { ids: string[]; cursor: string | null; hasMore: boolean };

/** Mounted sidebar owns bounded pages; push/focus invalidation replaces them. No polling. */
export function useSidebarSections(
  enabled: boolean,
  collapsed: ReadonlySet<string>
) {
  const { t } = useTranslation("navigation");
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(false);
  const [retainedIds, setRetainedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [dialog, setDialog] = useState<{
    id?: string;
    sessionId: string | null;
    name: string;
  } | null>(null);
  const generation = useRef(0);
  const requests = useRef(new Set<string>());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const report = useCallback(
    (error: unknown) => Message.error(String(error)),
    []
  );

  const invalidate = useCallback(() => {
    generation.current++;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const requestSet = requests.current;
    let inFlight = false;
    let pending = false;
    const refresh = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      const current = ++generation.current;
      try {
        const next = await rpc.sessionAggregate.sections();
        if (!disposed && current === generation.current) {
          setSnapshot(next);
          setPages({});
          setFailed(new Set());
          requests.current.clear();
          setLoadingId(null);
          setRevision(current);
        }
      } catch (error) {
        if (!disposed) report(error);
      } finally {
        inFlight = false;
        if (pending && !disposed) {
          pending = false;
          void refresh().catch(report);
        }
      }
    };
    const onFocus = () => {
      if (document.visibilityState !== "hidden") void refresh().catch(report);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh().catch(report);
    };
    const unlisten = listen("sidebar-sections-changed", onFocus).catch(
      (error) => {
        if (!disposed) report(error);
        return () => {};
      }
    );
    void refresh().catch(report);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      // Invalidate async pages; this ref is a generation counter, not a DOM ref.
      invalidate();
      requestSet.clear();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      void unlisten.then((dispose) => dispose()).catch(report);
    };
  }, [enabled, report, invalidate]);

  const load = useCallback(
    async (id: string, after: string | null = null) => {
      if (
        !enabled ||
        document.visibilityState === "hidden" ||
        requests.current.size > 0
      )
        return;
      requests.current.add(id);
      setLoadingId(id);
      const current = generation.current;
      try {
        const page = await rpc.sessionAggregate.sectionPage({
          id,
          after,
          limit: 20,
        });
        if (current !== generation.current) return;
        setRetainedIds(
          (previous) =>
            new Set(
              [...previous, ...page.sessions.map((s) => s.sessionId)].slice(
                -10_000
              )
            )
        );
        // A page discovers older identities; it must not overwrite a newer
        // live entity (especially a pin toggled while this read was in flight).
        const existing = new Set(
          getInstrumentedStore()
            .get(sessionsAtom)
            .map((session) => session.session_id)
        );
        for (const record of page.sessions) {
          if (!existing.has(record.sessionId))
            upsertSession(toFrontendSession(record));
        }
        setPages((previous) => ({
          ...previous,
          [id]: {
            ids: [
              ...new Set([
                ...(after ? (previous[id]?.ids ?? []) : []),
                ...page.sessions.map((s) => s.sessionId),
              ]),
            ],
            cursor: page.nextCursor,
            hasMore: page.hasMore,
          },
        }));
        setFailed((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      } catch (error) {
        if (current === generation.current) {
          setFailed((previous) => new Set(previous).add(id));
          report(error);
        }
      } finally {
        if (current === generation.current) {
          requests.current.delete(id);
          setLoadingId(null);
        }
      }
    },
    [enabled, report]
  );

  useEffect(() => {
    if (!enabled) return;
    // Sequential first pages avoid a burst of blocking-pool work on startup.
    let cancelled = false;
    void (async () => {
      for (const section of snapshot.sections) {
        if (cancelled) break;
        if (
          !collapsed.has(sectionGroupId(section.id)) &&
          !pages[section.id] &&
          !failed.has(section.id)
        )
          await load(section.id);
      }
    })().catch(report);
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    snapshot.sections,
    collapsed,
    pages,
    failed,
    load,
    revision,
    report,
  ]);

  const mutate = useCallback(
    async (mutation: SidebarSectionMutation) => {
      if (mutationLock.current) return false;
      mutationLock.current = true;
      setBusy(true);
      try {
        const next = await rpc.sessionAggregate.mutateSections({ mutation });
        if (!mounted.current) return true;
        generation.current++;
        requests.current.clear();
        setLoadingId(null);
        setSnapshot(next);
        setPages({});
        setFailed(new Set());
        setRevision(generation.current);
        return true;
      } catch (error) {
        report(error);
        return false;
      } finally {
        mutationLock.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [report]
  );

  const membership = useMemo(
    () => new Map(snapshot.members.map((m) => [m.sessionId, m.sectionId])),
    [snapshot]
  );
  const loadedIds = retainedIds;
  const openCreate = useCallback(
    (sessionId: string | null = null) => setDialog({ sessionId, name: "" }),
    []
  );
  const menuForSession = useCallback(
    (sessionId: string): NativeMenuItemOptions[] =>
      enabled
        ? [
            {
              text: t("sidebar.sections.section"),
              items: [
                ...snapshot.sections.map((section) => ({
                  text: section.name,
                  checked: membership.get(sessionId) === section.id,
                  action: () => {
                    void mutate({
                      kind: "assign",
                      sessionId,
                      sectionId: section.id,
                    }).catch(report);
                  },
                })),
                {
                  text: t("sidebar.sections.remove"),
                  enabled: membership.has(sessionId),
                  action: () => {
                    void mutate({
                      kind: "assign",
                      sessionId,
                      sectionId: null,
                    }).catch(report);
                  },
                },
                { item: "Separator" as const },
                {
                  text: t("sidebar.sections.create"),
                  action: () => openCreate(sessionId),
                },
              ],
            },
          ]
        : [],
    [enabled, snapshot.sections, membership, mutate, openCreate, t, report]
  );

  const headers = useMemo(
    () =>
      snapshot.sections.map(
        (section, index): NavigationMenuItem => ({
          id: `separator-${sectionGroupId(section.id)}`,
          key: `separator-${sectionGroupId(section.id)}`,
          label: section.name,
          rowActions: [
            {
              icon: MoreHorizontalIcon,
              label: t("sidebar.sections.manage"),
              onClick: () => {
                void popupNativeMenu({
                  source: "sidebar-section",
                  buildItems: () => [
                    {
                      text: t("sidebar.sections.rename"),
                      action: () =>
                        setDialog({
                          id: section.id,
                          sessionId: null,
                          name: section.name,
                        }),
                    },
                    ...([-1, 1] as const).map((direction) => ({
                      text:
                        direction < 0
                          ? t("sidebar.sections.up")
                          : t("sidebar.sections.down"),
                      enabled:
                        index + direction >= 0 &&
                        index + direction < snapshot.sections.length,
                      action: () => {
                        const ids = snapshot.sections.map((s) => s.id);
                        [ids[index], ids[index + direction]] = [
                          ids[index + direction],
                          ids[index],
                        ];
                        void mutate({ kind: "reorder", ids }).catch(report);
                      },
                    })),
                    { item: "Separator" },
                    {
                      text: t("sidebar.sections.delete"),
                      action: () => {
                        void mutate({ kind: "delete", id: section.id }).catch(
                          report
                        );
                      },
                    },
                  ],
                }).catch(report);
              },
            },
          ],
        })
      ),
    [snapshot.sections, mutate, report, t]
  );
  const pager = useCallback(
    (id: string): NavigationMenuItem | null => {
      if (!pages[id]?.hasMore && !failed.has(id) && loadingId !== id)
        return null;
      return {
        id: pageItemId(id),
        key: pageItemId(id),
        disabled: loadingId !== null,
        label:
          loadingId === id
            ? t("sessions:chat.loading")
            : failed.has(id)
              ? t("sidebar.sections.retry")
              : t("sidebar.sections.more"),
      };
    },
    [pages, failed, loadingId, t]
  );
  const handlePageClick = useCallback(
    (id: string) => {
      const section = snapshot.sections.find((s) => pageItemId(s.id) === id);
      if (!section) return false;
      void load(section.id, pages[section.id]?.cursor ?? null).catch(report);
      return true;
    },
    [snapshot.sections, load, pages, report]
  );

  const confirmName = () => {
    if (!dialog || busy || !dialog.name.trim()) return;

    void mutate(
      dialog.id
        ? { kind: "rename", id: dialog.id, name: dialog.name }
        : {
            kind: "create",
            name: dialog.name,
            sessionId: dialog.sessionId,
          }
    )
      .then((success) => {
        if (success && mounted.current) setDialog(null);
      })
      .catch(report);
  };
  return {
    membership: enabled ? membership : new Map<string, string>(),
    loadedIds: enabled ? loadedIds : new Set<string>(),
    headers: enabled ? headers : [],
    pager,
    menuForSession,
    handlePageClick,
    moveToSection: (sessionId: string, sectionId: string | null) =>
      mutate({ kind: "assign", sessionId, sectionId }),
    dialog:
      enabled && dialog ? (
        <Modal
          visible
          title={
            dialog.id
              ? t("sidebar.sections.rename")
              : t("sidebar.sections.create")
          }
          onCancel={() => {
            if (!busy) setDialog(null);
          }}
          onOk={confirmName}
          cancelText={t("common:actions.cancel")}
          okText={
            dialog.id
              ? t("sidebar.sections.rename")
              : t("sidebar.sections.create")
          }
          okButtonProps={{ loading: busy, disabled: !dialog.name.trim() }}
        >
          <Input
            aria-label={t("sidebar.sections.name")}
            placeholder={t("sidebar.sections.name")}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                confirmName();
              }
            }}
            maxLength={80}
            value={dialog.name}
            onChange={(name) => setDialog({ ...dialog, name })}
          />
        </Modal>
      ) : null,
  };
}
export type SidebarSectionsController = ReturnType<typeof useSidebarSections>;
