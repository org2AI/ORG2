/**
 * PrChecksRefreshButton
 *
 * The one "re-poll CI" control for the pull request detail view. It spins
 * through `useRefreshSpin`, so a click always shows at least the token's full
 * turn and keeps turning while the request — this click's or a scheduled
 * poll's — is still out.
 */
import React, { useCallback, useContext } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import { HugeiconsIcon, Refresh04Icon } from "@src/icons";

import { PrChecksRefreshContext } from "./prChecksRefreshContext";

interface PrChecksRefreshButtonProps {
  iconSize?: number;
  className?: string;
  testId?: string;
}

export function PrChecksRefreshButton({
  iconSize = 13,
  className = "",
  testId = "pr-checks-refresh",
}: PrChecksRefreshButtonProps): React.ReactNode {
  const { t } = useTranslation("common");
  const refresh = useContext(PrChecksRefreshContext);
  const refreshChecks = refresh?.refreshChecks;
  const onRefresh = useCallback(() => {
    void refreshChecks?.();
  }, [refreshChecks]);
  const refreshing = refresh?.refreshing ?? false;
  const { spinClass, handleClick } = useRefreshSpin(onRefresh, refreshing);

  if (!refresh) return null;

  const label = refreshing
    ? t("workstation.ci.refreshing")
    : t("workstation.ci.refresh");
  return (
    <Button
      htmlType="button"
      variant="tertiary"
      size="mini"
      iconOnly
      icon={
        <HugeiconsIcon
          icon={Refresh04Icon}
          data-icon="refresh-cw"
          size={iconSize}
          className={spinClass}
          aria-hidden
        />
      }
      className={`shrink-0 ${className}`.trim()}
      disabled={refreshing}
      title={label}
      aria-label={label}
      onClick={(event) => {
        // These buttons sit inside rows and panels that toggle on click.
        event.stopPropagation();
        handleClick();
      }}
      data-testid={testId}
    />
  );
}

PrChecksRefreshButton.displayName = "PrChecksRefreshButton";
