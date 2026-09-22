import React from "react";
import { useTranslation } from "react-i18next";

import Tooltip from "@src/components/Tooltip";
import type { KeyVaultAccount } from "@src/hooks/keyVault";

import { KEY_VAULT_STATUS_DOT, getAccountStatusLabel } from "./statusColors";

interface AccountStatusDotProps {
  account: KeyVaultAccount;
}

/**
 * Status dot for account table rows. Usable (`ready`) keys render nothing, so
 * a dot only appears when a key needs attention. Hovering explains the colour:
 * the status label plus the last failure.
 */
export function AccountStatusDot({
  account,
}: AccountStatusDotProps): React.ReactElement | null {
  const { t } = useTranslation("integrations");
  if (account.status === "ready") return null;

  const statusLabel = getAccountStatusLabel(account.status, t);
  const failureMessage = account.lastFailureMessage;

  return (
    <Tooltip
      content={
        <span style={{ whiteSpace: "pre-line" }}>
          {failureMessage ? `${statusLabel}\n${failureMessage}` : statusLabel}
        </span>
      }
      position="top"
      showArrow={false}
    >
      {/* Padding + negative margin widen the hover target without moving the dot. */}
      <span
        role="img"
        aria-label={statusLabel}
        className="-m-1 inline-flex shrink-0 p-1"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${KEY_VAULT_STATUS_DOT[account.status] ?? "bg-fill-3"}`}
        />
      </span>
    </Tooltip>
  );
}

export default AccountStatusDot;
