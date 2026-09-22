import React from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";

export interface ConnectingScreenProps {
  restoring?: boolean;
  /** @deprecated Demo-only timer path — live connect is driven by ConnectingLiveBridge. */
  onComplete?: () => void;
  delayMs?: number;
}

/** M-03 Connecting */
export function ConnectingScreen({ restoring = false }: ConnectingScreenProps) {
  const { t } = useTranslation("mobileRemote");

  return (
    <div className="mobile-flow-screen mobile-flow-screen--centered flex flex-1 flex-col items-center px-6">
      <Placeholder
        titleClassName="mobile-type-heading"
        subtitleClassName="mobile-type-secondary"
        variant="loading"
        title={t(
          restoring ? "connection.restoring" : "pairing.connectingTitle"
        )}
        subtitle={restoring ? undefined : t("pairing.connectingSubtitle")}
      />
    </div>
  );
}

ConnectingScreen.displayName = "ConnectingScreen";
