import React from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";

import { MobileActionButton } from "../components/MobileActionButton";

/** M-04 Connection Error */
export interface ConnectionErrorScreenProps {
  message?: string;
  onRetry?: () => void;
  onRepair?: () => void;
  busy?: boolean;
  actionError?: "retry" | "repair" | null;
}

export function ConnectionErrorScreen({
  message,
  onRetry,
  onRepair,
  busy = false,
  actionError,
}: ConnectionErrorScreenProps) {
  const { t } = useTranslation("mobileRemote");

  return (
    <div className="mobile-flow-screen mobile-flow-screen--centered flex flex-1 flex-col items-center px-6">
      <Placeholder
        titleClassName="mobile-type-heading"
        subtitleClassName="mobile-type-secondary"
        variant="error"
        title={t("connectionFailed")}
        subtitle={message}
      />
      {actionError ? (
        <p role="alert" className="mobile-type-secondary mt-4 text-danger-6">
          {t(`connectionRecovery.${actionError}Failed`)}
        </p>
      ) : null}
      {onRetry ? (
        <MobileActionButton
          variant="primary"
          className="mt-6 w-full max-w-xs"
          onClick={onRetry}
          disabled={busy}
        >
          {t("connectionRecovery.retry")}
        </MobileActionButton>
      ) : null}
      {onRepair ? (
        <MobileActionButton
          variant="secondary"
          className="mt-3 w-full max-w-xs"
          onClick={onRepair}
          disabled={busy}
        >
          {t("connectionRecovery.repair")}
        </MobileActionButton>
      ) : null}
    </div>
  );
}

ConnectionErrorScreen.displayName = "ConnectionErrorScreen";
