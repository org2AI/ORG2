import React, { Suspense, memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTablePagination } from "@src/components/SettingsTable/SettingsTablePagination";
import { getToolIcon } from "@src/config/toolIcons";
import {
  ChatLoadingBlock,
  SESSION_UI_TOKENS,
  StackedBlock,
} from "@src/engines/ChatPanel/blocks/primitives";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getChatLazyComponent } from "@src/engines/SessionCore/rendering/registry/events";
import { ActivitySparkIcon, HugeiconsIcon, WaypointsIcon } from "@src/icons";
import { getRegistryEventType } from "@src/lib/activityData/activityNormalizers";
import { getToolDisplayLabelFromRegistry } from "@src/util/ui/rendering/registryToolLabel";
import { deriveToolAction } from "@src/util/ui/rendering/toolAction";

import { toolActivityCanonical } from "../../ChatHistory/projection/compactToolActivity";
import { getBrowserGroupPresentation } from "../browserGroupPresentation";
import { summarizeWorkActivity } from "./summary";

const PAGE_SIZE = 20;

/** Mounted only on expansion; at most one page of heavy tool blocks exists. */
function WorkActivityPage({ events }: { events: SessionEvent[] }) {
  const { t } = useTranslation("common");
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.ceil(events.length / PAGE_SIZE);
  const page = Math.min(requestedPage, Math.max(0, pageCount - 1));
  return (
    <>
      {events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((event) => {
        const Component = getChatLazyComponent(getRegistryEventType(event));
        return (
          <Suspense key={event.id} fallback={<ChatLoadingBlock />}>
            <Component event={event} />
          </Suspense>
        );
      })}
      {pageCount > 1 && (
        <SettingsTablePagination
          pageIndex={page}
          pageSize={PAGE_SIZE}
          total={events.length}
          pageCount={pageCount}
          canPreviousPage={page > 0}
          canNextPage={page + 1 < pageCount}
          onPageChange={setPage}
          onPageSizeChange={() => {}}
          showPageSize={false}
          pageLabel={t("pagination.pageOf", {
            current: page + 1,
            total: pageCount,
          })}
        />
      )}
    </>
  );
}

function renderWorkPage(events: SessionEvent[]) {
  return <WorkActivityPage events={events} />;
}

const WorkActivityGroup = memo(function WorkActivityGroup({
  events,
}: {
  events: SessionEvent[];
}) {
  const { t } = useTranslation("sessions");
  const { counts, group } = useMemo(
    () => summarizeWorkActivity(events),
    [events]
  );
  const pages = useMemo(() => [events], [events]);
  const summary = [...counts]
    .map(([key, count]) => t(key, { count }))
    .join(t("tools.exploreSummary.separator"));
  const browserPresentation =
    group === "browser" ? getBrowserGroupPresentation(events) : null;
  const canonical = events[0] ? toolActivityCanonical(events[0]) : "";
  const firstAction = deriveToolAction(canonical, events[0]?.args);
  const sharedAction = events.every(
    (event) => deriveToolAction(canonical, event.args) === firstAction
  )
    ? firstAction
    : undefined;
  const label =
    group === "terminal"
      ? t("tools.runCommands")
      : group === "explore"
        ? t("tools.explore")
        : group === "edit"
          ? t("tools.editFiles")
          : group === "mixed"
            ? t("chat.performActions", { count: events.length })
            : (browserPresentation?.label ??
              getToolDisplayLabelFromRegistry(canonical, sharedAction));
  const icon =
    group === "mixed" || group === "explore" ? (
      <HugeiconsIcon
        icon={group === "mixed" ? ActivitySparkIcon : WaypointsIcon}
        size={SESSION_UI_TOKENS.ICON.SIZE_SM}
        className="text-text-2"
      />
    ) : (
      getToolIcon(
        group === "terminal"
          ? "run_shell"
          : group === "edit"
            ? "edit_file"
            : toolActivityCanonical(events[0]),
        { size: SESSION_UI_TOKENS.ICON.SIZE_SM, className: "text-text-2" }
      )
    );
  return (
    <StackedBlock
      items={pages}
      renderItem={renderWorkPage}
      icon={browserPresentation?.icon ?? icon}
      label={label}
      groupSummary={summary}
      defaultCollapsed
      eventId={events[0]?.id}
    />
  );
});

export default WorkActivityGroup;
