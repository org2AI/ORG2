import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import PageNotice from "@src/components/PageNotice";

import { mobileConnectionFailureKey } from "../connection/mobileConnectionFeedback";
import type { MobileConnectionState } from "../connection/types";

/** The provider owns recovery; this view only guards its pending user action. */
export function MobileConnectionNotice({
  connection,
  onRetry,
  className = "",
}: {
  connection: MobileConnectionState;
  onRetry?: () => Promise<boolean>;
  className?: string;
}) {
  const { t } = useTranslation("mobileRemote");
  const [busy, setBusy] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const online =
    connection.status === "connected" && connection.presence === "online";
  useEffect(() => {
    if (online) setRetryFailed(false);
  }, [online]);
  if (online) return null;
  if (!connection.error && !retryFailed && connection.status === "connecting") {
    return (
      <p role="status" className={className}>
        {t("connection.reconnecting")}
      </p>
    );
  }
  const retry = async () => {
    if (!onRetry || pending.current) return;
    pending.current = true;
    setBusy(true);
    setRetryFailed(false);
    try {
      const recovered = await onRetry();
      if (mounted.current) setRetryFailed(!recovered);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className={className}>
      <PageNotice
        type="warning"
        role="status"
        title={t("connectionFeedback.title")}
        titleClassName="mobile-type-secondary"
        bodyClassName="mobile-type-caption text-text-2"
        action={
          onRetry ? (
            <Button
              variant="tertiary"
              size="small"
              loading={busy}
              disabled={busy}
              style={{ minHeight: "var(--mobile-touch-size)" }}
              onClick={() => {
                void retry().catch(() => {
                  if (mounted.current) setRetryFailed(true);
                });
              }}
            >
              {t("connectionRecovery.retry")}
            </Button>
          ) : undefined
        }
      >
        {t(mobileConnectionFailureKey(connection.error))}
        {connection.status === "connecting" && (
          <span className="mt-1 block">{t("connectionFeedback.retrying")}</span>
        )}
        {retryFailed && (
          <span role="alert" className="mt-1 block">
            {t("connectionRecovery.retryFailed")}
          </span>
        )}
      </PageNotice>
    </div>
  );
}
