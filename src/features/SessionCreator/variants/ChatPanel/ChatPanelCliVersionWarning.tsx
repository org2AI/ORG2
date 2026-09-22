import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import RefreshButton from "@src/components/Button/RefreshButton";
import PageNotice from "@src/components/PageNotice";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import {
  Download02Icon,
  HugeiconsIcon,
  NotificationOff01Icon,
} from "@src/icons";

import CursorCliUpgradeButton from "./CursorCliUpgradeButton";
import type { SessionCreatorChatPanelViewProps } from "./chatPanelViewTypes";

interface ChatPanelCliVersionWarningProps {
  cliVersionAlert: NonNullable<
    SessionCreatorChatPanelViewProps["cliVersionAlert"]
  >;
}

/** Outdated-CLI warning with mute-until-next-version and refresh actions. */
export const ChatPanelCliVersionWarning: React.FC<
  ChatPanelCliVersionWarningProps
> = ({ cliVersionAlert }) => {
  const { t } = useTranslation(["sessions", "common"]);
  return (
    <div
      className={`mx-auto w-full ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
    >
      <PageNotice
        type="warning"
        compact
        copyable={false}
        icon={
          <HugeiconsIcon
            icon={Download02Icon}
            data-icon="download"
            size={14}
            strokeWidth={1.8}
          />
        }
        onClose={cliVersionAlert.onClose}
        closeAriaLabel={t("common:actions.close")}
        action={
          <div className="flex items-center gap-px">
            {cliVersionAlert.cliAgentType === "cursor_cli" && (
              <CursorCliUpgradeButton />
            )}
            <Button
              variant="tertiary"
              size="small"
              icon={
                <HugeiconsIcon
                  icon={NotificationOff01Icon}
                  data-icon="bell-off"
                  size={14}
                  strokeWidth={1.8}
                />
              }
              iconOnly
              disabled={!cliVersionAlert.latestVersion}
              title={t("creator.cliVersionOutdated.muteUntilNextVersion")}
              aria-label={t("creator.cliVersionOutdated.muteUntilNextVersion")}
              data-testid="session-creator-cli-version-mute"
              onClick={cliVersionAlert.onMuteUntilNextVersion}
            />
            <RefreshButton
              iconOnly
              label={t("creator.cliVersionOutdated.refresh", {
                cli: cliVersionAlert.cliDisplayName,
              })}
              refreshing={cliVersionAlert.refreshing}
              onRefresh={cliVersionAlert.onRefresh}
              dataTestId="session-creator-cli-version-refresh"
            />
          </div>
        }
        title={t("creator.cliVersionOutdated.title", {
          cli: cliVersionAlert.cliDisplayName,
        })}
        subtitle={
          <span className="break-all">
            {t("creator.cliVersionOutdated.versions", {
              installed:
                cliVersionAlert.installedVersion ??
                t("creator.cliVersionOutdated.unknownVersion"),
              latest:
                cliVersionAlert.latestVersion ??
                t("creator.cliVersionOutdated.unknownVersion"),
            })}
          </span>
        }
      />
    </div>
  );
};
