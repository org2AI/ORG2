import React, { memo, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import {
  ArrowDown01Icon,
  HugeiconsIcon,
  Loading03Icon,
  WorkflowCircle05Icon,
} from "@src/icons";
import { classNames } from "@src/util/ui/classNames";

import { StatusBarButton, StatusBarLabel } from "./StatusBarBase";
import { StatusBarTooltip } from "./StatusBarTooltip";

const MENU_ICON_SIZE = DROPDOWN_ITEM.iconSize;

interface GitInitializationStatusMenuProps {
  isInitializing: boolean;
  onInitialize: () => Promise<void>;
}

export const GitInitializationStatusMenu: React.FC<GitInitializationStatusMenuProps> =
  memo(({ isInitializing, onInitialize }) => {
    const { t } = useTranslation();
    const {
      close,
      isOpen,
      isPositioned,
      panelPosition,
      panelRef,
      toggle,
      triggerRef,
    } = useDropdownEngine<HTMLDivElement>({
      align: "left",
      gap: DROPDOWN_PANEL.triggerGap,
      placement: "top",
    });
    const [isActionPending, setIsActionPending] = useState(false);

    const handleInitialize = useCallback(() => {
      close();
      setIsActionPending(true);
      const clearPendingState = () => setIsActionPending(false);
      onInitialize().then(clearPendingState, clearPendingState);
    }, [close, onInitialize]);

    const actionPending = isInitializing || isActionPending;
    const label = actionPending
      ? t("sourceControl.initializingGit")
      : t("workstation.notGitInitialized");
    const tooltip = t("workstation.notGitInitializedTooltip");
    const tooltipLabel = actionPending
      ? t("sourceControl.initializingGit")
      : tooltip;

    return (
      <div ref={triggerRef} className="flex h-full">
        <StatusBarTooltip label={tooltipLabel} disabled={isOpen}>
          <StatusBarButton
            onClick={toggle}
            disabled={actionPending}
            ariaLabel={tooltipLabel}
            active={isOpen}
            className="gap-2"
            dataTestId="status-bar-git-initialization"
          >
            <HugeiconsIcon
              icon={actionPending ? Loading03Icon : WorkflowCircle05Icon}
              data-icon={actionPending ? "loader-2" : "git-branch"}
              size={MENU_ICON_SIZE}
              className={classNames(
                "text-text-1",
                actionPending && "animate-spin"
              )}
            />
            <StatusBarLabel emphasis className="text-text-1">
              {label}
            </StatusBarLabel>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              data-icon="chevron-down"
              size={12}
              className="text-text-3"
            />
          </StatusBarButton>
        </StatusBarTooltip>

        {isOpen &&
          isPositioned &&
          createPortal(
            <div
              ref={panelRef}
              className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.wideMenuClass}`}
              style={{
                position: "fixed",
                top: panelPosition.top,
                bottom: panelPosition.bottom,
                left: panelPosition.left,
                right: panelPosition.right,
              }}
              role="menu"
            >
              <div className={DROPDOWN_CLASSES.itemsColumn}>
                <Button
                  layout="custom"
                  className={classNames(
                    DROPDOWN_CLASSES.menuActionItem,
                    actionPending && DROPDOWN_CLASSES.itemDisabled
                  )}
                  disabled={actionPending}
                  onClick={handleInitialize}
                  role="menuitem"
                  data-testid="status-bar-git-initialize"
                >
                  <HugeiconsIcon
                    icon={actionPending ? Loading03Icon : WorkflowCircle05Icon}
                    data-icon={actionPending ? "loader-2" : "git-branch"}
                    size={MENU_ICON_SIZE}
                    className={classNames(
                      "shrink-0",
                      actionPending && "animate-spin"
                    )}
                  />
                  <span>{label}</span>
                </Button>
              </div>
            </div>,
            document.body
          )}
      </div>
    );
  });

GitInitializationStatusMenu.displayName = "GitInitializationStatusMenu";

export default GitInitializationStatusMenu;
