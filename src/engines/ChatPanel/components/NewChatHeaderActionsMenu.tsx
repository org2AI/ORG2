import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  ActionMenuSurface,
  ActionSubmenu,
} from "@src/components/Dropdown/ActionMenuSurface";
import {
  MenuSegmentedRow,
  MenuSwitchRow,
} from "@src/components/Dropdown/MenuControlRows";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { CREATOR_COMPOSER_POSITION } from "@src/config/sessionCreatorConfig";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { getDropdownPanelStyle, useDropdownEngine } from "@src/hooks/dropdown";
import { HugeiconsIcon, Layers01Icon, MoreHorizontalIcon } from "@src/icons";
import { cliUpdateAlertsEnabledAtom } from "@src/store/session/cliUpdateAlertsAtom";
import { creatorComposerPositionAtom } from "@src/store/session/creatorComposerPositionAtom";
import { creatorLaunchpadActionsVisibleAtom } from "@src/store/session/creatorLaunchpadActionsVisibleAtom";
import { creatorLaunchpadSearchVisibleAtom } from "@src/store/session/creatorLaunchpadSearchVisibleAtom";
import { changeCreatorComposerPositionAtom } from "@src/store/session/creatorRepoChromePositionAtom";

import { SessionInputSettingsSubmenu } from "./SessionInputSettingsSubmenu";

export function NewChatHeaderActionsMenu(): React.ReactNode {
  const { t } = useTranslation(["sessions", "common"]);
  const [cliUpdateAlertsEnabled, setCliUpdateAlertsEnabled] = useAtom(
    cliUpdateAlertsEnabledAtom
  );
  const composerPosition = useAtomValue(creatorComposerPositionAtom);
  const setComposerPosition = useSetAtom(changeCreatorComposerPositionAtom);
  const [launchpadActionsVisible, setLaunchpadActionsVisible] = useAtom(
    creatorLaunchpadActionsVisibleAtom
  );
  const [launchpadSearchVisible, setLaunchpadSearchVisible] = useAtom(
    creatorLaunchpadSearchVisibleAtom
  );
  const {
    isOpen,
    isPositioned,
    toggle,
    close,
    triggerRef,
    panelRef,
    panelPosition,
  } = useDropdownEngine<HTMLButtonElement>({
    align: "right",
    placement: "bottom",
    captureKeyboardFocus: true,
    // ActionMenuSurface owns keyboard navigation across the submenu.
    autoKeyboardNavigation: false,
    closeOnEsc: false,
  });

  return (
    <>
      <Button
        ref={triggerRef}
        variant="tertiary"
        size="small"
        iconOnly
        className={isOpen ? "bg-fill-1! text-primary-6!" : ""}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-label={t("common:actions.more")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-testid="new-chat-header-more-button"
        icon={
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            data-icon="ellipsis"
            size={HEADER_ICON_SIZE.sm}
            strokeWidth={2}
          />
        }
      />
      {isOpen &&
        isPositioned &&
        createPortal(
          <ActionMenuSurface
            panelRef={panelRef}
            onClose={close}
            className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.sidebarMenuClass}`}
            style={{
              ...getDropdownPanelStyle(panelPosition, { widthMode: "none" }),
              position: "fixed",
              zIndex: DROPDOWN_PANEL.zIndex,
            }}
          >
            <ActionSubmenu
              label={t("common:common.display")}
              icon={
                <HugeiconsIcon
                  icon={Layers01Icon}
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                />
              }
              dataTestId="new-chat-ui-settings-submenu"
            >
              <MenuSwitchRow
                label={t("chat.startPage.showSpotlight")}
                checked={launchpadSearchVisible}
                onCheckedChange={setLaunchpadSearchVisible}
                dataTestId="new-chat-show-spotlight-toggle"
              />
              <div
                role="separator"
                className={DROPDOWN_CLASSES.menuGroupSeparator}
              />
              <MenuSegmentedRow
                label={t("chat.startPage.inputPosition")}
                dataTestId="new-chat-composer-position"
                value={composerPosition}
                options={[
                  {
                    value: CREATOR_COMPOSER_POSITION.BOTTOM,
                    label: t("chat.startPage.positionBottom"),
                  },
                  {
                    value: CREATOR_COMPOSER_POSITION.MIDDLE,
                    label: t("chat.startPage.positionMiddle"),
                  },
                ]}
                onChange={setComposerPosition}
              />
              <MenuSwitchRow
                label={t("chat.startPage.showQuickActions")}
                checked={launchpadActionsVisible}
                onCheckedChange={setLaunchpadActionsVisible}
                dataTestId="new-chat-show-quick-actions-toggle"
              />
              <MenuSwitchRow
                label={t("chat.startPage.showCliUpdate")}
                checked={cliUpdateAlertsEnabled}
                onCheckedChange={setCliUpdateAlertsEnabled}
                dataTestId="new-chat-show-cli-update-toggle"
              />
            </ActionSubmenu>
            <SessionInputSettingsSubmenu variant="launchpad" />
          </ActionMenuSurface>,
          document.body
        )}
    </>
  );
}
