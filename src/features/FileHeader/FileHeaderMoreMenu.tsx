/**
 * FileHeaderMoreMenu
 *
 * Renders the "More actions" dropdown surfaced by {@link FileHeader} via the
 * Ellipsis trailing icon. Groups menu entries into three semantic blocks:
 *
 *  - File change actions     — Save / Discard.
 *  - Menu actions            — Search / Go to line / Copy relative path / Reload.
 *  - UI settings submenu     — Editor display switches / More settings.
 *  - Sidebar settings submenu — WorkStation sidebar visibility / location /
 *                               indent lines.
 *
 * Unavailable actions are omitted from the current file context.
 */
import React, { useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  ActionMenuSurface,
  ActionSubmenu,
} from "@src/components/Dropdown/ActionMenuSurface";
import DropdownActionItem from "@src/components/Dropdown/DropdownActionItem";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Switch from "@src/components/Switch";
import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import Tooltip from "@src/components/Tooltip";
import { useShortcutKeys } from "@src/config/keyboard/useShortcutBindings";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import {
  ArrowUpRight01Icon,
  Copy01Icon,
  EllipsisIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  HashtagIcon,
  HugeiconsIcon,
  Layers01Icon,
  Refresh04Icon,
  SearchList01Icon,
  Undo03Icon,
} from "@src/icons";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";

import { FileHeaderSidebarSettingsSubmenu } from "./FileHeaderSidebarSettingsSubmenu";

export interface FileHeaderMoreMenuProps {
  renderFileActions?: (close: () => void) => React.ReactNode;
  // Visibility flags
  showReloadButton: boolean;
  showSearchAction: boolean;
  showGoToLineAction: boolean;
  showSaveAction: boolean;
  showDiscardAction: boolean;
  showCopyRelativePathAction: boolean;
  showRevealInFileManagerAction: boolean;
  showLineNumbersToggle: boolean;
  /** Split diffs only: both line-number columns between the panes. */
  showSplitCenteredLineNumbersToggle?: boolean;
  showWordWrapToggle: boolean;
  showMinimapToggle: boolean;
  showHighlightActiveLineToggle: boolean;
  showGitBlameToggle: boolean;
  showMoreSettingsAction: boolean;
  /** Show the WorkStation sidebar settings submenu. */
  showSidebarSettings?: boolean;

  // Toggle current values
  lineNumbersEnabled: boolean;
  splitCenteredLineNumbersEnabled?: boolean;
  wordWrapEnabled: boolean;
  /**
   * The surface forces wrapping on (split diffs). The row stays visible,
   * reads as on, and cannot be toggled, so the forced default is discoverable
   * instead of the setting silently disappearing.
   */
  wordWrapLocked?: boolean;
  minimapEnabled: boolean;
  highlightActiveLineEnabled: boolean;
  gitBlameEnabled: boolean;

  // States
  loading: boolean;
  hasUnsavedChanges: boolean;
  reloadSpinClass: string | undefined;
  reloadMenuCoolingDown: boolean;
  menuVisible: boolean;
  setMenuVisible: (visible: boolean) => void;

  // Handlers
  onSaveClick: () => void;
  onDiscardClick: () => void;
  onSearchClick: () => void;
  onGoToLineClick: () => void;
  onCopyRelativePathClick: () => void;
  onRevealInFileManagerClick: () => void;
  onReloadClick: () => void;
  onLineNumbersChange: (enabled: boolean) => void;
  onSplitCenteredLineNumbersChange?: (enabled: boolean) => void;
  onWordWrapChange: (enabled: boolean) => void;
  onMinimapChange: (enabled: boolean) => void;
  onHighlightActiveLineChange: (enabled: boolean) => void;
  onGitBlameChange: (enabled: boolean) => void;
  onMoreSettingsClick: () => void;
}

export const FileHeaderMoreMenu: React.FC<FileHeaderMoreMenuProps> = ({
  renderFileActions,
  showReloadButton,
  showSearchAction,
  showGoToLineAction,
  showSaveAction,
  showDiscardAction,
  showCopyRelativePathAction,
  showRevealInFileManagerAction,
  showLineNumbersToggle,
  showSplitCenteredLineNumbersToggle = false,
  showWordWrapToggle,
  showMinimapToggle,
  showHighlightActiveLineToggle,
  showGitBlameToggle,
  showMoreSettingsAction,
  showSidebarSettings = false,
  lineNumbersEnabled,
  splitCenteredLineNumbersEnabled = false,
  wordWrapEnabled,
  wordWrapLocked = false,
  minimapEnabled,
  highlightActiveLineEnabled,
  gitBlameEnabled,
  loading,
  hasUnsavedChanges,
  reloadSpinClass,
  reloadMenuCoolingDown,
  menuVisible,
  setMenuVisible,
  onSaveClick,
  onDiscardClick,
  onSearchClick,
  onGoToLineClick,
  onCopyRelativePathClick,
  onRevealInFileManagerClick,
  onReloadClick,
  onLineNumbersChange,
  onSplitCenteredLineNumbersChange,
  onWordWrapChange,
  onMinimapChange,
  onHighlightActiveLineChange,
  onGitBlameChange,
  onMoreSettingsClick,
}) => {
  const { t } = useTranslation();
  const { isPositioned, triggerRef, panelRef, panelPosition, toggle, close } =
    useDropdownEngine<HTMLSpanElement>({
      open: menuVisible,
      onOpenChange: setMenuVisible,
      align: "right",
      // The shared surface owns navigation and closes one menu layer at a time.
      autoKeyboardNavigation: false,
      closeOnEsc: false,
    });
  const searchShortcut = useShortcutKeys("find");
  const goToLineShortcut = useShortcutKeys("go_to_line");
  const saveShortcut = useShortcutKeys("save_file");
  const revealInFileManagerLabelKey = getFileManagerRevealLabelKey();
  const fileChangeActionsDisabled = !hasUnsavedChanges || loading;
  const saveDisabled = !showSaveAction || fileChangeActionsDisabled;
  const discardDisabled = !showDiscardAction || fileChangeActionsDisabled;
  const searchDisabled = !showSearchAction;
  const goToLineDisabled = !showGoToLineAction;
  const copyRelativePathDisabled = !showCopyRelativePathAction;
  const revealInFileManagerDisabled = !showRevealInFileManagerAction;
  const reloadDisabled = !showReloadButton || loading || reloadMenuCoolingDown;

  const hasFileChangeActions = !saveDisabled || !discardDisabled;
  const hasNavigationActions =
    !searchDisabled ||
    !goToLineDisabled ||
    !copyRelativePathDisabled ||
    !revealInFileManagerDisabled ||
    !reloadDisabled;
  const hasDisplayToggles =
    showLineNumbersToggle ||
    showWordWrapToggle ||
    showMinimapToggle ||
    showHighlightActiveLineToggle ||
    showGitBlameToggle;
  const hasDisplaySettings =
    hasDisplayToggles || showMoreSettingsAction || showSidebarSettings;
  const fileActions =
    menuVisible && isPositioned ? renderFileActions?.(close) : null;
  const hasFileActions = React.Children.toArray(fileActions).length > 0;

  const renderToggleRow = useCallback(
    ({
      label,
      checked,
      enabled,
      disabled = false,
      onChange,
    }: {
      label: string;
      checked: boolean;
      /** Whether the row is shown at all. */
      enabled: boolean;
      /** Shown but not interactive. */
      disabled?: boolean;
      onChange: (enabled: boolean) => void;
    }) => {
      if (!enabled) return null;
      const handleToggle = (event: React.MouseEvent | React.KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        onChange(!checked);
      };

      return (
        <div
          role="menuitemcheckbox"
          aria-checked={checked}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          className={`${DROPDOWN_CLASSES.menuControlItem} ${
            disabled ? DROPDOWN_CLASSES.itemDisabled : "cursor-pointer"
          }`}
          onClick={handleToggle}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            handleToggle(event);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <Switch
            size="small"
            ariaLabel={label}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(nextChecked, event) => {
              event.preventDefault();
              event.stopPropagation();
              onChange(nextChecked);
            }}
          />
        </div>
      );
    },
    []
  );

  return (
    <>
      <Tooltip
        content={
          <KeyboardShortcutTooltipContent label={t("common:actions.more")} />
        }
        position="bottom-end"
        kind="button"
        disabled={menuVisible}
        framedPanel
      >
        <span ref={triggerRef} className="inline-flex">
          <TabBarTrailingIconButton
            title={t("common:actions.more")}
            active={menuVisible}
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={menuVisible}
            nativeTitle={false}
            tooltipDisabled
            className="shrink-0"
          >
            <HugeiconsIcon
              icon={EllipsisIcon}
              data-icon="ellipsis"
              size={HEADER_ICON_SIZE.sm}
              strokeWidth={1.75}
            />
          </TabBarTrailingIconButton>
        </span>
      </Tooltip>
      {menuVisible &&
        isPositioned &&
        createPortal(
          <ActionMenuSurface
            panelRef={panelRef}
            onClose={close}
            aria-label={t("common:actions.more")}
            data-testid="file-header-more-menu"
            className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.wideMenuClass} scrollbar-overlay`}
            style={{
              position: "fixed",
              top: panelPosition.top,
              bottom: panelPosition.bottom,
              right: panelPosition.right,
              maxHeight: panelPosition.maxHeight,
              overflowY: "auto",
              zIndex: DROPDOWN_PANEL.zIndex,
            }}
          >
            {!saveDisabled && (
              <DropdownActionItem
                icon={
                  <HugeiconsIcon
                    icon={FloppyDiskIcon}
                    data-icon="save"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={saveDisabled}
                shortcut={saveShortcut}
                onClick={onSaveClick}
              >
                {t("common:actions.save")}
              </DropdownActionItem>
            )}

            {!discardDisabled && (
              <DropdownActionItem
                icon={
                  <HugeiconsIcon
                    icon={Undo03Icon}
                    data-icon="undo-3"
                    size={HEADER_ICON_SIZE.discard}
                  />
                }
                disabled={discardDisabled}
                onClick={onDiscardClick}
              >
                {t("common:workstation.discardChanges")}
              </DropdownActionItem>
            )}

            {hasFileChangeActions &&
              (hasNavigationActions || hasFileActions) && (
                <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
              )}

            {!searchDisabled && (
              <DropdownActionItem
                icon={
                  <HugeiconsIcon
                    icon={SearchList01Icon}
                    data-icon="search-list-01"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={searchDisabled}
                shortcut={searchShortcut}
                onClick={onSearchClick}
              >
                {t("actions.search")}
              </DropdownActionItem>
            )}

            {!goToLineDisabled && (
              <DropdownActionItem
                icon={
                  <HugeiconsIcon
                    icon={HashtagIcon}
                    data-icon="hash"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={goToLineDisabled}
                shortcut={goToLineShortcut}
                onClick={onGoToLineClick}
              >
                {t("selectors.editorSpotlight.modes.goToLine.label")}
              </DropdownActionItem>
            )}

            {!copyRelativePathDisabled && (
              <DropdownActionItem
                icon={
                  <HugeiconsIcon
                    icon={Copy01Icon}
                    data-icon="copy"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={copyRelativePathDisabled}
                onClick={onCopyRelativePathClick}
              >
                {t("common:actions.copyRelativePath")}
              </DropdownActionItem>
            )}

            {!revealInFileManagerDisabled && (
              <DropdownActionItem
                icon={
                  <HugeiconsIcon
                    icon={FolderOpenIcon}
                    data-icon="folder-open"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={revealInFileManagerDisabled}
                onClick={onRevealInFileManagerClick}
              >
                {t(revealInFileManagerLabelKey)}
              </DropdownActionItem>
            )}

            {!reloadDisabled && (
              <DropdownActionItem
                icon={
                  <HugeiconsIcon
                    icon={Refresh04Icon}
                    data-icon="refresh-cw"
                    size={HEADER_ICON_SIZE.sm}
                    className={reloadSpinClass}
                  />
                }
                disabled={reloadDisabled}
                onClick={onReloadClick}
              >
                {t("common:actions.refresh")}
              </DropdownActionItem>
            )}

            {fileActions}
            {hasDisplaySettings &&
              (hasFileChangeActions ||
                hasNavigationActions ||
                hasFileActions) && (
                <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
              )}
            {(hasDisplayToggles || showMoreSettingsAction) && (
              <ActionSubmenu
                label={t("common:common.display")}
                icon={
                  <HugeiconsIcon
                    icon={Layers01Icon}
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
                dataTestId="file-header-ui-settings-submenu"
              >
                {renderToggleRow({
                  label: t("settings:editor.lineNumbers"),
                  checked: lineNumbersEnabled,
                  enabled: showLineNumbersToggle,
                  onChange: onLineNumbersChange,
                })}

                {onSplitCenteredLineNumbersChange &&
                  renderToggleRow({
                    label: t("settings:editor.splitDiffCenteredLineNumbers"),
                    checked: splitCenteredLineNumbersEnabled,
                    enabled: showSplitCenteredLineNumbersToggle,
                    onChange: onSplitCenteredLineNumbersChange,
                  })}

                {renderToggleRow({
                  label: t("settings:editor.wordWrap"),
                  checked: wordWrapLocked || wordWrapEnabled,
                  enabled: showWordWrapToggle,
                  disabled: wordWrapLocked,
                  onChange: onWordWrapChange,
                })}

                {renderToggleRow({
                  label: t("settings:editor.minimap"),
                  checked: minimapEnabled,
                  enabled: showMinimapToggle,
                  onChange: onMinimapChange,
                })}

                {renderToggleRow({
                  label: t("settings:editor.highlightActiveLine"),
                  checked: highlightActiveLineEnabled,
                  enabled: showHighlightActiveLineToggle,
                  onChange: onHighlightActiveLineChange,
                })}

                {renderToggleRow({
                  label: t("settings:editor.gitBlame"),
                  checked: gitBlameEnabled,
                  enabled: showGitBlameToggle,
                  onChange: onGitBlameChange,
                })}

                {hasDisplayToggles && showMoreSettingsAction && (
                  <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
                )}

                {showMoreSettingsAction && (
                  <DropdownActionItem
                    disabled={!showMoreSettingsAction}
                    onClick={onMoreSettingsClick}
                    suffix={
                      <HugeiconsIcon
                        icon={ArrowUpRight01Icon}
                        data-icon="arrow-up-right"
                        size={DROPDOWN_ITEM.iconSize}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                    }
                  >
                    {t("common:actions.moreSettings")}
                  </DropdownActionItem>
                )}
              </ActionSubmenu>
            )}
            {showSidebarSettings && <FileHeaderSidebarSettingsSubmenu />}
          </ActionMenuSurface>,
          document.body
        )}
    </>
  );
};
