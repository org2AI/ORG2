/**
 * FileHeaderMoreMenu
 *
 * Renders the "More actions" dropdown surfaced by {@link FileHeader} via the
 * Ellipsis trailing icon. Groups menu entries into three semantic blocks:
 *
 *  - File change actions     — Save / Discard.
 *  - Menu actions            — Search / Go to line / Copy relative path / Reload.
 *  - UI settings submenu     — Editor display switches / More settings.
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
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import {
  KEYBOARD_SHORTCUT_VARIANT,
  KeyboardShortcut,
  KeyboardShortcutTooltipContent,
} from "@src/components/KeyboardShortcut";
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
  Search01Icon,
  Settings01Icon,
  Undo03Icon,
} from "@src/icons";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";

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
  showWordWrapToggle: boolean;
  showMinimapToggle: boolean;
  showHighlightActiveLineToggle: boolean;
  showGitBlameToggle: boolean;
  showMoreSettingsAction: boolean;

  // Toggle current values
  lineNumbersEnabled: boolean;
  wordWrapEnabled: boolean;
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
  showWordWrapToggle,
  showMinimapToggle,
  showHighlightActiveLineToggle,
  showGitBlameToggle,
  showMoreSettingsAction,
  lineNumbersEnabled,
  wordWrapEnabled,
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
  const hasDisplaySettings = hasDisplayToggles || showMoreSettingsAction;
  const fileActions =
    menuVisible && isPositioned ? renderFileActions?.(close) : null;
  const hasFileActions = React.Children.toArray(fileActions).length > 0;

  const renderToggleRow = useCallback(
    ({
      label,
      checked,
      enabled,
      onChange,
    }: {
      label: string;
      checked: boolean;
      enabled: boolean;
      onChange: (enabled: boolean) => void;
    }) => {
      if (!enabled) return null;
      const handleToggle = (event: React.MouseEvent | React.KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (!enabled) return;
        onChange(!checked);
      };

      return (
        <div
          role="menuitemcheckbox"
          aria-checked={checked}
          aria-disabled={!enabled}
          tabIndex={enabled ? 0 : -1}
          className={`${DROPDOWN_CLASSES.menuControlItem} ${
            enabled ? "cursor-pointer" : DROPDOWN_CLASSES.itemDisabled
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
            disabled={!enabled}
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
        mouseEnterDelay={200}
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
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                icon={
                  <HugeiconsIcon
                    icon={FloppyDiskIcon}
                    data-icon="save"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={saveDisabled}
                suffix={
                  saveShortcut ? (
                    <KeyboardShortcut
                      shortcut={saveShortcut}
                      variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
                    />
                  ) : undefined
                }
                onClick={onSaveClick}
              >
                {t("common:actions.save")}
              </DropdownItem>
            )}

            {!discardDisabled && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                icon={
                  <HugeiconsIcon
                    icon={Undo03Icon}
                    data-icon="undo-3"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={discardDisabled}
                onClick={onDiscardClick}
              >
                {t("common:workstation.discardChanges")}
              </DropdownItem>
            )}

            {hasFileChangeActions &&
              (hasNavigationActions || hasFileActions) && (
                <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
              )}

            {!searchDisabled && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                icon={
                  <HugeiconsIcon
                    icon={Search01Icon}
                    data-icon="search"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={searchDisabled}
                suffix={
                  searchShortcut ? (
                    <KeyboardShortcut
                      shortcut={searchShortcut}
                      variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
                    />
                  ) : undefined
                }
                onClick={onSearchClick}
              >
                {t("actions.search")}
              </DropdownItem>
            )}

            {!goToLineDisabled && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                icon={
                  <HugeiconsIcon
                    icon={HashtagIcon}
                    data-icon="hash"
                    size={HEADER_ICON_SIZE.sm}
                  />
                }
                disabled={goToLineDisabled}
                suffix={
                  goToLineShortcut ? (
                    <KeyboardShortcut
                      shortcut={goToLineShortcut}
                      variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
                    />
                  ) : undefined
                }
                onClick={onGoToLineClick}
              >
                {t("selectors.editorSpotlight.modes.goToLine.label")}
              </DropdownItem>
            )}

            {!copyRelativePathDisabled && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
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
              </DropdownItem>
            )}

            {!revealInFileManagerDisabled && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
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
              </DropdownItem>
            )}

            {!reloadDisabled && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
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
              </DropdownItem>
            )}

            {fileActions}
            {hasDisplaySettings &&
              (hasFileChangeActions ||
                hasNavigationActions ||
                hasFileActions) && (
                <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
              )}
            {hasDisplaySettings && (
              <ActionSubmenu
                label={t("sessions:chat.pageSettings")}
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

                {renderToggleRow({
                  label: t("settings:editor.wordWrap"),
                  checked: wordWrapEnabled,
                  enabled: showWordWrapToggle,
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
                  label: "Git Blame",
                  checked: gitBlameEnabled,
                  enabled: showGitBlameToggle,
                  onChange: onGitBlameChange,
                })}

                {hasDisplayToggles && showMoreSettingsAction && (
                  <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
                )}

                {showMoreSettingsAction && (
                  <DropdownItem
                    role="menuitem"
                    fullWidth
                    tabIndex={0}
                    icon={
                      <HugeiconsIcon
                        icon={Settings01Icon}
                        data-icon="settings"
                        size={HEADER_ICON_SIZE.sm}
                      />
                    }
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
                  </DropdownItem>
                )}
              </ActionSubmenu>
            )}
          </ActionMenuSurface>,
          document.body
        )}
    </>
  );
};
