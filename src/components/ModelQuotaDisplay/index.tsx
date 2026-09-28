import React from "react";
import { useTranslation } from "react-i18next";

import QuotaBar from "@src/components/QuotaBar";
import {
  buildModelQuotaMetrics,
  formatQuotaResetTime,
} from "@src/hooks/keyVault/accountQuotaDisplay";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";

/** Uses the same reported pool projection as start-page account cards. No refresh owner. */
export default function ModelQuotaDisplay({
  quotaInfo,
}: {
  quotaInfo: KeyVaultAccount["quotaInfo"];
}) {
  const { t } = useTranslation("integrations");
  const metrics = buildModelQuotaMetrics(quotaInfo, t);
  if (!metrics.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {metrics.map((metric) => {
        const reset = formatQuotaResetTime(metric.resetTime);
        return (
          <QuotaBar
            key={metric.key}
            remainingPercent={metric.remainingPercent}
            label={reset ? `${metric.label} (${reset.compact})` : metric.label}
          />
        );
      })}
    </div>
  );
}
