import { useAtom, useAtomValue } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { WorkstationTrailHeader } from "@src/components/layout/blocks";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import {
  TYPOGRAPHY,
  WORKSTATION_TRAIL_CONTENT,
} from "@src/config/workstation/tokens";
import { useCachedSubagentParentDetails } from "@src/engines/Simulator/hooks/useCachedSubagentParentDetails";
import { useSubagentRoster } from "@src/engines/Simulator/hooks/useSubagentRoster";
import { subagentJobMapAtom } from "@src/store/session/subagentJobAtom";
import type { SessionTrailSurface } from "@src/store/workstation/sessionTrailSurfaceAtom";
import {
  EMPTY_SUBAGENT_TRAIL_VIEW,
  subagentTrailViewAtom,
} from "@src/store/workstation/subagentTrailViewAtom";
import { startVisibilityAwareInterval } from "@src/util/time/scheduling/visibilityAwareInterval";

import { SubagentTrailCard } from "./SubagentTrailCard";
import { SubagentTrailHistory } from "./SubagentTrailHistory";

export function SubagentTrailContent({
  surface,
}: {
  surface: SessionTrailSurface;
}) {
  const { t } = useTranslation();
  const scope = `${surface.ownerTabId}:${surface.sessionId}`;
  const [saved, setSaved] = useAtom(subagentTrailViewAtom);
  const view =
    saved.scope === scope ? saved : { ...EMPTY_SUBAGENT_TRAIL_VIEW, scope };
  const { sessions, loaded, error, retry } = useSubagentRoster(
    surface.sessionId
  );
  const jobs = useAtomValue(subagentJobMapAtom).get(surface.sessionId);
  const parentDetails = useCachedSubagentParentDetails(
    view.selected ? null : surface.sessionId
  );
  const [now, setNow] = useState(Date.now);
  const listRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(view.scrollTop);
  const patch = (value: Partial<typeof view>) =>
    setSaved((previous) => ({
      ...(previous.scope === scope
        ? previous
        : { ...EMPTY_SUBAGENT_TRAIL_VIEW, scope }),
      ...value,
    }));
  useLayoutEffect(() => {
    setSaved((previous) => ({
      ...(previous.scope === scope
        ? previous
        : { ...EMPTY_SUBAGENT_TRAIL_VIEW, scope }),
      // Explicit entry always lands at the requested record or the overview.
      selected: surface.childSessionId ?? null,
    }));
  }, [scope, surface.childSessionId, setSaved]);
  useEffect(
    () => () => {
      // Scroll is presentation state: retain it on close, not on every pixel.
      setSaved((previous) =>
        previous.scope === scope
          ? { ...previous, scrollTop: initialScroll.current }
          : previous
      );
    },
    [scope, setSaved]
  );
  const selected = sessions.find((child) => child.sessionId === view.selected);
  const running = sessions.filter((child) => !child.isTerminal);
  const finished = sessions.filter((child) => child.isTerminal);
  const ticking = running.length > 0 && !view.selected;
  useEffect(() => {
    if (!ticking) return;
    return startVisibilityAwareInterval(
      document,
      () => setNow(Date.now()),
      1000
    );
  }, [ticking]);
  useLayoutEffect(() => {
    if (loaded && listRef.current)
      listRef.current.scrollTop = initialScroll.current;
  }, [loaded]);
  const visible = [...running, ...finished].slice(0, view.visibleCount);
  const visibleRunning = visible.filter((child) => !child.isTerminal);
  const visibleFinished = visible.filter((child) => child.isTerminal);
  const card = (child: (typeof sessions)[number]) => (
    <SubagentTrailCard
      key={child.sessionId}
      session={child}
      parentSessionId={surface.sessionId}
      now={now}
      taskTitle={parentDetails.get(child.sessionId)?.title}
      canStop={jobs?.has(child.sessionId) ?? false}
      onView={() => patch({ selected: child.sessionId })}
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-subagent-trail>
      {error && (
        <div
          role="alert"
          className={`flex items-center justify-between gap-2 px-2 py-1 ${TYPOGRAPHY.secondary} text-text-2`}
        >
          {t("sessions:subagentTrail.loadError")}
          <Button
            variant="tertiary"
            size="sidebar"
            onClick={() => void retry()}
          >
            {t("common:actions.retry")}
          </Button>
        </div>
      )}
      {!loaded && !error && (
        <p role="status" className={`p-2 ${TYPOGRAPHY.value} text-text-3`}>
          {t("common:status.loading")}
        </p>
      )}
      {loaded && view.selected && (
        <div className="min-h-0 flex-1">
          {selected ? (
            <SubagentTrailHistory key={selected.sessionId} session={selected} />
          ) : (
            <p className={`p-2 ${TYPOGRAPHY.value} text-text-3`}>
              {t("sessions:subagentTrail.recordUnavailable")}
            </p>
          )}
        </div>
      )}
      <div
        ref={listRef}
        hidden={!!view.selected}
        className={`scrollbar-hide min-h-0 flex-1 overflow-y-auto p-1 ${WORKSTATION_TRAIL_CONTENT.sectionList}`}
        onScroll={(event) => {
          initialScroll.current = event.currentTarget.scrollTop;
        }}
      >
        {loaded && !sessions.length && (
          <p className={`p-2 ${TYPOGRAPHY.value} text-text-3`}>
            {t("sessions:subagentTrail.noTasks")}
          </p>
        )}
        {visibleRunning.length > 0 && (
          <section className={WORKSTATION_TRAIL_CONTENT.section}>
            <WorkstationTrailHeader
              title={`${t("common:git.rail.subagentRunning")} · ${running.length}`}
            />
            <div className={DETAIL_PANEL_TOKENS.contentStack}>
              {visibleRunning.map(card)}
            </div>
          </section>
        )}
        {visibleFinished.length > 0 && (
          <section className={WORKSTATION_TRAIL_CONTENT.section}>
            <WorkstationTrailHeader
              title={t("sessions:subagentTrail.finished", {
                count: finished.length,
              })}
            />
            <div className={DETAIL_PANEL_TOKENS.contentStack}>
              {visibleFinished.map(card)}
            </div>
          </section>
        )}
        {visible.length < sessions.length && (
          <Button
            variant="tertiary"
            size="sidebar"
            className="mt-2"
            onClick={() => patch({ visibleCount: view.visibleCount + 20 })}
          >
            {t("sessions:subagentTrail.showMore")}
          </Button>
        )}
      </div>
    </div>
  );
}
