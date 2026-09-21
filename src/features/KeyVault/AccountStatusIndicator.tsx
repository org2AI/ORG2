import React from "react";
import { useTranslation } from "react-i18next";

import StatusDot from "@src/components/StatusDot";
import type { KeyVaultAccount } from "@src/hooks/keyVault";

import { KEY_VAULT_STATUS_DOT, getAccountStatusLabel } from "./statusColors";

interface AccountStatusIndicatorProps {
  account: KeyVaultAccount;
}

export function AccountStatusIndicator({
  account,
}: AccountStatusIndicatorProps): React.ReactElement {
  const { t } = useTranslation("integrations");
  const statusLabel = getAccountStatusLabel(account.status, t);

  return (
    <StatusDot
      color={KEY_VAULT_STATUS_DOT[account.status] ?? "bg-fill-3"}
      size="inline"
      label={statusLabel}
    />
  );
}
