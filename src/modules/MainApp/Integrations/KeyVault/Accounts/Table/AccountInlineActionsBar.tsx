import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import { buildAccountReauthPath } from "@src/config/mainAppPaths";
import { AccountStatusIndicator } from "@src/features/KeyVault/AccountStatusIndicator";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";
import { HugeiconsIcon, Refresh04Icon } from "@src/icons";

import { InlineCardFooter } from "../../shared/InlineCardPrimitives";
import {
  areAccountRefreshActionsDisabled,
  reconnectableOAuthAgent,
} from "./accountInlineActions";

interface AccountInlineActionsBarProps {
  account: KeyVaultAccount;
  refreshing?: boolean;
  refreshingModels?: boolean;
  refreshLabel?: string;
  onRefresh?: () => void | Promise<void>;
  onRefreshModels?: () => void | Promise<void>;
  onEdit?: () => void;
  onDisconnect?: (accountId: string, deleteType?: "local" | "cloud") => void;
}

export const AccountInlineActionsBar: React.FC<
  AccountInlineActionsBarProps
> = ({
  account,
  refreshing = false,
  refreshingModels = false,
  refreshLabel,
  onRefresh,
  onRefreshModels,
  onEdit,
  onDisconnect,
}) => {
  const { t } = useTranslation("integrations");
  const { t: tCommon } = useTranslation();
  const navigate = useNavigate();

  const { spinClass, handleClick: handleRefreshClick } = useRefreshSpin(
    onRefresh ?? (() => {}),
    refreshing
  );
  const { spinClass: modelSpinClass, handleClick: handleRefreshModelsClick } =
    useRefreshSpin(onRefreshModels ?? (() => {}), refreshingModels);

  const showEdit = !account.listingId && account.hasLocalKey && onEdit;
  const reconnectAgent = reconnectableOAuthAgent(account);
  const anyRefreshing = areAccountRefreshActionsDisabled(
    refreshing,
    refreshingModels
  );
  const resolvedRefreshLabel = refreshLabel ?? tCommon("actions.refresh");
  return (
    <InlineCardFooter>
      <div className="mr-auto flex min-h-7 items-center">
        <AccountStatusIndicator account={account} />
      </div>
      {reconnectAgent ? (
        <Button
          variant="primary"
          size="small"
          onClick={() =>
            navigate(buildAccountReauthPath(reconnectAgent, account.id))
          }
          title={tCommon("errors.reconnectCodex")}
        >
          {tCommon("errors.reconnectCodex")}
        </Button>
      ) : null}
      {onRefresh ? (
        <Button
          size="small"
          onClick={handleRefreshClick}
          disabled={anyRefreshing}
          icon={
            <HugeiconsIcon
              icon={Refresh04Icon}
              data-icon="refresh-cw"
              size={14}
              className={spinClass}
            />
          }
          title={resolvedRefreshLabel}
        >
          {resolvedRefreshLabel}
        </Button>
      ) : null}
      {onRefreshModels ? (
        <Button
          size="small"
          onClick={handleRefreshModelsClick}
          disabled={anyRefreshing}
          icon={
            <HugeiconsIcon
              icon={Refresh04Icon}
              data-icon="refresh-cw"
              size={14}
              className={modelSpinClass}
            />
          }
          title={t("keyVault.refreshModels.button")}
        >
          {t("keyVault.refreshModels.button")}
        </Button>
      ) : null}
      {showEdit ? (
        <Button size="small" onClick={onEdit}>
          {tCommon("actions.edit")}
        </Button>
      ) : null}
      {onDisconnect && account.hasLocalKey && account.isListed ? (
        <>
          <Button
            tone="danger"
            size="small"
            onClick={() => onDisconnect(account.id, "local")}
          >
            {t("keyVault.removeLocal")}
          </Button>
          <Button
            tone="danger"
            size="small"
            onClick={() => onDisconnect(account.id, "cloud")}
          >
            {t("keyVault.unlist")}
          </Button>
        </>
      ) : null}
      {onDisconnect && !(account.hasLocalKey && account.isListed) ? (
        <Button
          tone="danger"
          size="small"
          onClick={() => onDisconnect(account.id)}
        >
          {account.hasLocalKey
            ? tCommon("actions.remove")
            : tCommon("actions.delete")}
        </Button>
      ) : null}
    </InlineCardFooter>
  );
};
