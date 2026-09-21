import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  SESSION_ROW_PRESENTATION,
  SessionRowLeadingIcon,
  SessionRowStatusDot,
} from "@src/components/SessionRowPresentation";
import { isSessionInProgress } from "@src/util/session/sessionInProgress";
import { resolveSessionRowIcon } from "@src/util/session/sessionSidebarRow";
import { isSessionCompletedUnread } from "@src/util/session/sessionStatusDot";

import type { MobileSessionDisplay } from "../connection/types";
import {
  type MobileRowStatus,
  mobileSessionIconInput,
} from "./sessionRowPresentation";

export interface SessionListItemProps {
  sessionId: string;
  name: string;
  status: MobileRowStatus;
  display?: MobileSessionDisplay;
  /** Undefined means unsynchronized/unsupported, never assume unread. */
  visited?: boolean;
  mergeStatus?: string | null;
  workspaceName?: string | null;
  /** Workspace is already conveyed by the section heading. */
  compact?: boolean;
  updatedAtMs?: number;
  onSelect?: () => void;
}

export function SessionListItem({
  sessionId,
  name,
  status,
  display,
  visited,
  mergeStatus,
  workspaceName,
  compact = false,
  updatedAtMs,
  onSelect,
}: SessionListItemProps) {
  const { t, i18n } = useTranslation("mobileRemote");
  const statusTone =
    status === "awaiting_approval" || status === "waiting_for_user"
      ? "asking"
      : isSessionInProgress(status)
        ? "working"
        : visited === false &&
            isSessionCompletedUnread(
              { session_id: sessionId, status, mergeStatus },
              new Set()
            )
          ? "unread"
          : "default";
  const statusLabel =
    statusTone === "unread"
      ? t("sessions.state.unread")
      : t(`sessions.state.${status}`);
  const updated = updatedAtMs == null ? null : new Date(updatedAtMs);
  const timestamp =
    updated && !Number.isNaN(updated.getTime()) ? (
      <time
        className="mobile-session-row__time mobile-type-caption text-text-3"
        dateTime={updated.toISOString()}
      >
        {updated.toLocaleString(i18n?.language, {
          month: "short",
          day: "numeric",
        })}
      </time>
    ) : null;

  return (
    <Button
      layout="custom"
      data-testid="mobile-remote-session-row"
      className={`mobile-session-row flex w-full text-left ${compact ? "mobile-session-row--compact" : "min-h-16"}`}
      onClick={onSelect}
    >
      <span
        className={`${SESSION_ROW_PRESENTATION.content} mobile-session-row__content`}
      >
        <SessionRowLeadingIcon
          icon={resolveSessionRowIcon(
            mobileSessionIconInput(sessionId, display)
          )}
          iconLabel={`session-${sessionId}`}
        />
        <span className={SESSION_ROW_PRESENTATION.text}>
          <span className="mobile-session-row__heading">
            <span className="mobile-session-row__title" title={name}>
              {name}
            </span>
            <span
              className="inline-flex shrink-0"
              data-session-status={status}
              title={statusLabel}
            >
              <SessionRowStatusDot tone={statusTone} label={statusLabel} />
            </span>
          </span>
          {!compact ? (
            <span className="mobile-session-row__meta">
              {workspaceName ? (
                <span className="mobile-session-row__workspace">
                  {workspaceName}
                </span>
              ) : null}
              {timestamp}
            </span>
          ) : null}
        </span>
      </span>
    </Button>
  );
}

SessionListItem.displayName = "SessionListItem";
