/**
 * BrowserStatusBar
 *
 * Status bar for Browser showing:
 * - URL and loading status
 * - Tab navigation
 * - Console error/warning counts (click opens in-app DevTools)
 *
 * Uses BaseStatusBar for consistent layout.
 */
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  Add01Icon,
  Alert01Icon,
  CancelCircleIcon,
  CleanIcon,
  HugeiconsIcon,
} from "@src/icons";

import { PortsStatusMenu } from "./PortsStatusMenu";
import {
  BaseStatusBar,
  StatusBarButton,
  StatusBarLabel,
  StatusBarText,
} from "./StatusBarBase";

export interface BrowserStatusBarProps {
  /** Number of console errors */
  errorCount: number;
  /** Number of console warnings */
  warningCount: number;
  /** Toggle DevTools panel */
  onToggleDevTools: () => void;
  /** True while an element is selected via the inspector. */
  hasSelectedElement?: boolean;
  /** Short label for the selected element (e.g. "div.hp_trivia_outer"). */
  selectedElementLabel?: string;
  /** Send the currently selected element to the Chat composer. */
  onSendSelectedElementToChat?: () => void;
  /** Clear the current inspector element selection. */
  onClearSelectedElement?: () => void;
  className?: string;
}

const BrowserStatusBar: React.FC<BrowserStatusBarProps> = memo(
  ({
    errorCount,
    warningCount,
    onToggleDevTools,
    hasSelectedElement = false,
    selectedElementLabel,
    onSendSelectedElementToChat,
    onClearSelectedElement,
    className,
  }) => {
    const { t } = useTranslation();

    const itemTextClass = "text-text-1";

    // Left content: console issue counts (opens in-app DevTools on click)
    const leftContent = useMemo(
      () => (
        <div className="flex h-full shrink-0 items-center gap-1">
          {/* Combined issues button (warnings + errors) */}
          {(warningCount > 0 || errorCount > 0) && (
            <StatusBarButton
              onClick={onToggleDevTools}
              title={`${errorCount} error${errorCount !== 1 ? "s" : ""}, ${warningCount} warning${warningCount !== 1 ? "s" : ""}`}
              className="gap-2"
            >
              {errorCount > 0 && (
                <span className={`flex items-center gap-1 ${itemTextClass}`}>
                  <HugeiconsIcon
                    icon={CancelCircleIcon}
                    data-icon="xcircle"
                    size={13}
                  />
                  <StatusBarLabel emphasis numeric>
                    {errorCount}
                  </StatusBarLabel>
                </span>
              )}
              {warningCount > 0 && (
                <span className={`flex items-center gap-1 ${itemTextClass}`}>
                  <HugeiconsIcon
                    icon={Alert01Icon}
                    data-icon="alert-triangle"
                    size={13}
                  />
                  <StatusBarLabel emphasis numeric>
                    {warningCount}
                  </StatusBarLabel>
                </span>
              )}
            </StatusBarButton>
          )}
          <PortsStatusMenu />
        </div>
      ),
      [itemTextClass, warningCount, errorCount, onToggleDevTools]
    );

    // Button text reuses the terminal selection menu label so both surfaces
    // read the same way.
    const rightContent = useMemo(() => {
      if (!hasSelectedElement || !onSendSelectedElementToChat) return null;
      const sendLabel = t("browser.selectedElement.addElement");
      const clearLabel = t("actions.clearSelection");
      return (
        <div className="flex h-full items-center gap-1">
          {selectedElementLabel && (
            <StatusBarText
              muted
              className="max-w-[240px] truncate"
              title={selectedElementLabel}
            >
              {selectedElementLabel}
            </StatusBarText>
          )}
          {onClearSelectedElement && (
            <StatusBarButton
              onClick={onClearSelectedElement}
              title={clearLabel}
              className="text-text-2"
            >
              <HugeiconsIcon icon={CleanIcon} data-icon="clean" size={13} />
            </StatusBarButton>
          )}
          <StatusBarButton
            variant="primary"
            onClick={onSendSelectedElementToChat}
            title={sendLabel}
          >
            <HugeiconsIcon icon={Add01Icon} data-icon="plus" size={13} />
            <span>{sendLabel}</span>
          </StatusBarButton>
        </div>
      );
    }, [
      hasSelectedElement,
      onSendSelectedElementToChat,
      onClearSelectedElement,
      selectedElementLabel,
      t,
    ]);

    return (
      <BaseStatusBar
        leftContent={leftContent}
        rightContent={rightContent}
        className={className}
      />
    );
  }
);

BrowserStatusBar.displayName = "BrowserStatusBar";

export default BrowserStatusBar;
