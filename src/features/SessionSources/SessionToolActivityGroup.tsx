import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { parseHttpUrlPill } from "@src/components/ComposerInput/httpUrl";
import PageNotice from "@src/components/PageNotice";
import { SidebarSectionHeader } from "@src/components/SidebarSectionHeader";
import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";
import { useCollapsible } from "@src/hooks/ui/useCollapsible";
import { HugeiconsIcon, Link01Icon } from "@src/icons";
import { getToolDisplayLabelFromRegistry } from "@src/util/ui/rendering/registryToolLabel";

import { SessionSourceIcon } from "./SessionSourceIcon";
import {
  type AggregatedToolActivityDetail,
  type ToolActionKind,
  aggregateToolActivity,
} from "./aggregateToolActivity";
import { sourceLabel } from "./presentation";

const COUNT_KEYS = {
  search: "toolSearchCount",
  open: "toolOpenCount",
  "read-terminal": "toolTerminalCount",
  generic: "toolCallCount",
} as const;
const DETAIL_PAGE_SIZE = 20;

function ToolActivitySection({
  kind,
  details,
  totalCount,
  onOpenSource,
}: {
  kind: ToolActionKind;
  details: AggregatedToolActivityDetail[];
  totalCount: number;
  onOpenSource: (source: SessionSource) => void;
}) {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useState(DETAIL_PAGE_SIZE);
  const { isOpen, toggle } = useCollapsible({ defaultOpen: false });
  return (
    <div>
      <SidebarSectionHeader
        surface="group"
        titleStyle="name"
        title={t(`common:git.rail.${COUNT_KEYS[kind]}`, { count: totalCount })}
        expanded={isOpen}
        onToggle={toggle}
      />
      {isOpen ? (
        <div className="mr-3 ml-7 space-y-2 py-2">
          {details
            .slice(0, visibleCount)
            .map(({ key, operation, action, occurrenceCount }) => {
              const url =
                action.url && parseHttpUrlPill(action.url) ? action.url : null;
              return (
                <div
                  key={key}
                  className="flex min-w-0 items-start gap-2 text-xs"
                  data-tool-activity-call={operation.callId}
                >
                  <div className="min-w-0 flex-1">
                    {action.query ? (
                      <p className="m-0 break-words text-text-2">
                        {action.query}
                      </p>
                    ) : null}
                    {url ? (
                      <Button
                        variant="ghost"
                        size="inline"
                        className="max-w-full text-left text-primary-6 hover:underline"
                        icon={
                          <HugeiconsIcon
                            icon={Link01Icon}
                            size={12}
                            aria-hidden
                          />
                        }
                        title={url}
                        onClick={() =>
                          onOpenSource({
                            kind: "link",
                            key: `tool-url:${url}`,
                            url,
                            label: url,
                            origin: "tool-result",
                            toolName: operation.toolName,
                          })
                        }
                      >
                        {url}
                      </Button>
                    ) : null}
                    {action.url && !url ? (
                      <p className="m-0 break-words text-text-3">
                        {action.url}
                      </p>
                    ) : null}
                    {action.kind === "generic" &&
                    !action.query &&
                    !action.url ? (
                      <p className="m-0 break-words text-text-3">
                        {getToolDisplayLabelFromRegistry(operation.toolName)}
                      </p>
                    ) : null}
                    {operation.status === "error" ? (
                      <PageNotice
                        type="danger"
                        compact
                        copyable={false}
                        role="status"
                        className="mt-2"
                      >
                        {operation.error || t("common:git.rail.toolFailed")}
                      </PageNotice>
                    ) : null}
                  </div>
                  {occurrenceCount > 1 ? (
                    <span className="shrink-0 text-xs text-text-3">
                      {t("common:git.rail.toolRepeatCount", {
                        count: occurrenceCount,
                      })}
                    </span>
                  ) : null}
                </div>
              );
            })}
          {details.length > visibleCount ? (
            <Button
              variant="tertiary"
              size="small"
              onClick={() =>
                setVisibleCount((count) => count + DETAIL_PAGE_SIZE)
              }
            >
              {t("common:git.rail.toolLoadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SessionToolActivityGroup({
  source,
  onOpenSource,
}: {
  source: Extract<SessionSource, { kind: "tool-group" }>;
  onOpenSource: (source: SessionSource) => void;
}) {
  const { t } = useTranslation();
  const categories = useMemo(
    () => aggregateToolActivity(source.operations),
    [source.operations]
  );
  return (
    <section
      aria-label={sourceLabel(t, source)}
      data-testid="workstation-tool-activity"
      className="py-1"
    >
      <SidebarSectionHeader
        surface="panel"
        titleStyle="name"
        title={sourceLabel(t, source)}
        icon={<SessionSourceIcon source={source} />}
      />
      {categories.map(({ kind, details, totalCount }) => (
        <ToolActivitySection
          key={kind}
          kind={kind}
          details={details}
          totalCount={totalCount}
          onOpenSource={onOpenSource}
        />
      ))}
    </section>
  );
}
