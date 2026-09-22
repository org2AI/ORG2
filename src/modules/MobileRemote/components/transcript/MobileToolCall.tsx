import React from "react";

import Button from "@src/components/Button";
import { getToolIcon } from "@src/config/toolIcons";
import { EventBlockHeader } from "@src/engines/ChatPanel/blocks/primitives/EventBlockHeader";
import { EventBlockHeaderIcon } from "@src/engines/ChatPanel/blocks/primitives/EventBlockHeaderIcon";
import {
  EventBlockHeaderInfo,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
} from "@src/engines/ChatPanel/blocks/primitives/EventBlockHeaderTextSlots";
import {
  SESSION_UI_TOKENS,
  getEventBlockContainerClasses,
} from "@src/engines/ChatPanel/blocks/primitives/config";
import { ArrowRight01Icon, HugeiconsIcon } from "@src/icons";

import type { TranscriptItem } from "../../lib/transcriptReducer";
import { record, stringValue } from "./mobileToolPresentation";
import { useMobileToolPresentation } from "./useMobileToolPresentation";

export {
  mobileToolSummary,
  normalizeMobileToolLifecycle,
  resolveMobileToolIconName,
} from "./mobileToolPresentation";

interface MobileToolCallProps {
  item: TranscriptItem;
  onOpenDetails?: () => void;
  detailsOpen?: boolean;
}

export function MobileToolCall({
  item,
  onOpenDetails,
  detailsOpen = false,
}: MobileToolCallProps) {
  const {
    t,
    lifecycle,
    rawName,
    title,
    callTitle,
    summary,
    hasDetails,
    statusLabel,
    isLoading,
    isFailed,
  } = useMobileToolPresentation(item);

  const toolIcon = getToolIcon(rawName, {
    size: SESSION_UI_TOKENS.ICON.SIZE_SM,
    className: SESSION_UI_TOKENS.ICON.DEFAULT,
    action: stringValue(record(item.toolData)?.action) || undefined,
  });

  const statusClassName = isFailed
    ? "text-danger-6"
    : isLoading
      ? "text-info-6"
      : undefined;
  const showDetailsChevron = hasDetails && Boolean(onOpenDetails);

  const header = (
    <div className={getEventBlockContainerClasses(false)}>
      <EventBlockHeader
        isCollapsed
        withHover={false}
        rightContent={
          <div
            className="flex shrink-0 items-center gap-0.5"
            data-mobile-tool-status-trailing="true"
          >
            <EventBlockHeaderInfo
              isLoading={isLoading}
              className={`min-w-13 text-right whitespace-nowrap ${statusClassName ?? ""}`.trim()}
            >
              {statusLabel}
            </EventBlockHeaderInfo>
            <span
              className="flex shrink-0 items-center justify-center"
              style={{ width: SESSION_UI_TOKENS.ICON.SIZE_SM }}
              aria-hidden={!showDetailsChevron}
            >
              {showDetailsChevron ? (
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={SESSION_UI_TOKENS.ICON.SIZE_SM}
                  className="text-text-3"
                  aria-hidden="true"
                />
              ) : null}
            </span>
          </div>
        }
      >
        <EventBlockHeaderIcon
          icon={toolIcon}
          isCollapsed
          hasContent={false}
          isLoading={isLoading}
          isFailed={isFailed}
        />
        <EventBlockHeaderTitle
          isLoading={isLoading}
          truncate={Boolean(callTitle)}
          title={callTitle}
          className={isFailed ? "text-text-3" : undefined}
        >
          {title}
        </EventBlockHeaderTitle>
        {summary ? (
          <EventBlockHeaderSubtitle
            isLoading={isLoading}
            title={summary}
            className={`min-w-0 flex-1 ${isFailed ? "text-text-3" : "text-text-1"}`}
          >
            <span className="min-w-0 truncate">{summary}</span>
          </EventBlockHeaderSubtitle>
        ) : null}
      </EventBlockHeader>
    </div>
  );

  if (!hasDetails || !onOpenDetails) {
    return (
      <div
        className="w-full min-w-0"
        data-tool-call-name={rawName}
        data-tool-call-layout="inline"
        data-tool-call-status={lifecycle}
      >
        {header}
      </div>
    );
  }

  return (
    <Button
      layout="custom"
      className="block w-full min-w-0 border-0 bg-transparent p-0 text-left focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
      aria-haspopup="dialog"
      aria-expanded={detailsOpen}
      aria-label={[
        t("transcript.tools.openDetails", { tool: title }),
        summary,
        statusLabel,
      ]
        .filter(Boolean)
        .join(" · ")}
      onClick={onOpenDetails}
      data-tool-call-name={rawName}
      data-tool-call-layout="inline"
      data-tool-call-status={lifecycle}
      data-tool-call-action="open-details"
    >
      {header}
    </Button>
  );
}

MobileToolCall.displayName = "MobileToolCall";
