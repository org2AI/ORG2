import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { Placeholder } from "@src/components/Placeholder";
import { HugeiconsIcon, Notification01Icon } from "@src/icons";

import type { MobilePendingInbox } from "../app/useMobilePendingInbox";
import type { MobileSessionRow } from "../connection/types";

export function PendingInboxList({
  inbox,
  sessions,
  desktopName,
  online,
  onSelectSession,
  onFocusPermission,
}: {
  inbox: MobilePendingInbox;
  sessions: MobileSessionRow[];
  desktopName: string;
  online: boolean;
  onSelectSession?: (id: string) => void;
  onFocusPermission?: (requestId: string) => void;
}) {
  const { t, i18n } = useTranslation("mobileRemote");
  return (
    <section className="mobile-pending-list" aria-label={t("inbox.title")}>
      {!online ? <p className="text-text-2">{t("inbox.offline")}</p> : null}
      {inbox.phase === "syncing" ? (
        <p role="status">{t("inbox.syncing")}</p>
      ) : null}
      {inbox.phase === "error" ? (
        <div role="alert">
          <p>{t("inbox.error")}</p>
          <Button onClick={inbox.refresh} disabled={!online}>
            {t("sessions.retry")}
          </Button>
        </div>
      ) : null}
      {inbox.phase === "ready" && !inbox.complete ? (
        <p>{t("inbox.incomplete")}</p>
      ) : null}
      {inbox.phase === "ready" && inbox.complete && inbox.items.length === 0 ? (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("inbox.empty")}
          icon={<HugeiconsIcon icon={Notification01Icon} size={24} />}
        />
      ) : null}
      {inbox.items.map((request) => {
        const row = sessions.find(
          (session) => session.id === request.sessionId
        );
        const detail = ["command", "path", "description"]
          .map((key) => request.toolArgs[key])
          .find((value) => typeof value === "string") as string | undefined;
        const date = new Date(request.createdAtMs);
        return (
          <Button
            layout="custom"
            key={`${request.origin}:${request.sessionId}:${request.requestId}`}
            className="mobile-pending-card"
            disabled={!online}
            onClick={() => {
              onFocusPermission?.(request.requestId);
              onSelectSession?.(request.sessionId);
            }}
          >
            <span className="mobile-pending-card__title">
              {request.sessionName ?? row?.name ?? request.sessionId}
            </span>
            <span className="mobile-type-secondary truncate text-text-2">
              {desktopName}
              {!Number.isNaN(date.getTime())
                ? ` · ${date.toLocaleString(i18n?.language)}`
                : ""}
            </span>
            <span className="mobile-pending-card__request">
              {request.toolName}
              {detail ? ` · ${detail}` : ""}
            </span>
            {request.toolArgsTruncated ? (
              <span className="mobile-type-secondary text-text-2">
                {t("inbox.truncated")}
              </span>
            ) : null}
            <span className="mobile-type-secondary text-primary-6">
              {t("inbox.open")}
            </span>
          </Button>
        );
      })}
    </section>
  );
}
