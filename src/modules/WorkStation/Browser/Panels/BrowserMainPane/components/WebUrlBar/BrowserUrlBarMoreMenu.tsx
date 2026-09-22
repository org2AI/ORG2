/**
 * BrowserUrlBarMoreMenu
 *
 * The "..." menu at the right end of the Browser URL bar. Holds the actions
 * that do not earn a permanent toolbar button: the page color scheme, saving a
 * screenshot to disk, opening a local HTML file, importing cookies from another
 * browser, and the native DevTools.
 */
import { useAtom } from "jotai";
import React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { ActionMenuSurface } from "@src/components/Dropdown/ActionMenuSurface";
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import { MenuSegmentedRow } from "@src/components/Dropdown/MenuControlRows";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { getDropdownPanelStyle, useDropdownEngine } from "@src/hooks/dropdown";
import {
  CodeXmlIcon,
  CookieIcon,
  Download01Icon,
  FolderOpenIcon,
  HugeiconsIcon,
  MonitorIcon,
  MoonIcon,
  MoreHorizontalIcon,
  Sun01Icon,
} from "@src/icons";
import { isBrowserPageColorSchemeSupported } from "@src/modules/WorkStation/Browser/hooks/useBrowserPageColorSchemeSync";
import { browserPageColorSchemeAtom } from "@src/store/workstation/browser/pageColorSchemeAtom";

// Same glyphs as Settings → Appearance's mode pill, so "page theme" reads as
// the page-level twin of the app theme.
const PAGE_THEME_OPTIONS = [
  { value: "auto", labelKey: "browser.menu.themeAuto", icon: MonitorIcon },
  { value: "light", labelKey: "browser.menu.themeLight", icon: Sun01Icon },
  { value: "dark", labelKey: "browser.menu.themeDark", icon: MoonIcon },
] as const;

export interface BrowserUrlBarMoreMenuProps {
  /** Capture the current page and save it to a file the user picks. */
  onSaveScreenshot?: () => void;
  /** Whether a page is loaded, i.e. there is something to capture. */
  canSaveScreenshot?: boolean;
  /** Pick a local HTML file and open it in this tab. */
  onOpenHtmlFile?: () => void;
  /**
   * Open the "import cookies from your browser" flow. The host omits it where
   * importing is not offered (private tabs, embedded browser panes).
   */
  onImportCookies?: () => void;
  /** Open native browser DevTools (Safari Inspector / Edge DevTools). */
  onOpenNativeDevTools?: () => void;
  /** Whether a native webview exists for DevTools to attach to. */
  canOpenNativeDevTools?: boolean;
}

export function BrowserUrlBarMoreMenu({
  onSaveScreenshot,
  canSaveScreenshot = false,
  onOpenHtmlFile,
  onImportCookies,
  onOpenNativeDevTools,
  canOpenNativeDevTools = false,
}: BrowserUrlBarMoreMenuProps): React.ReactNode {
  const { t } = useTranslation();
  const [pageColorScheme, setPageColorScheme] = useAtom(
    browserPageColorSchemeAtom
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
    // ActionMenuSurface owns keyboard navigation.
    autoKeyboardNavigation: false,
    closeOnEsc: false,
  });

  const showPageTheme = isBrowserPageColorSchemeSupported();
  const hasFileActions = Boolean(
    onSaveScreenshot || onOpenHtmlFile || onImportCookies
  );
  const hasDevTools = Boolean(onOpenNativeDevTools);
  if (!showPageTheme && !hasFileActions && !hasDevTools) return null;

  const runAndClose = (action: () => void) => () => {
    close();
    action();
  };

  return (
    <>
      {/* The tooltip would sit on top of the menu it just opened. */}
      <ToolbarTooltip label={t("common:actions.more")} disabled={isOpen}>
        <Button
          ref={triggerRef}
          variant="tertiary"
          size="small"
          iconOnly
          className={isOpen ? "bg-fill-2! text-primary-6!" : ""}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          aria-label={t("common:actions.more")}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-testid="browser-url-bar-more-button"
          icon={
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              data-icon="ellipsis"
              size={HEADER_ICON_SIZE.sm}
              strokeWidth={2}
            />
          }
        />
      </ToolbarTooltip>
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
            {showPageTheme && (
              <MenuSegmentedRow
                label={t("browser.menu.pageTheme")}
                dataTestId="browser-page-theme"
                value={pageColorScheme}
                options={PAGE_THEME_OPTIONS.map((option) => ({
                  value: option.value,
                  ariaLabel: t(option.labelKey),
                  tooltip: t(option.labelKey),
                  label: (
                    <HugeiconsIcon
                      icon={option.icon}
                      data-icon={`theme-${option.value}`}
                      size={14}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  ),
                }))}
                onChange={setPageColorScheme}
              />
            )}
            {showPageTheme && (hasFileActions || hasDevTools) && (
              <div
                role="separator"
                className={DROPDOWN_CLASSES.menuGroupSeparator}
              />
            )}
            {onSaveScreenshot && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                onClick={runAndClose(onSaveScreenshot)}
                disabled={!canSaveScreenshot}
                dataTestId="browser-save-screenshot"
                icon={
                  <HugeiconsIcon
                    icon={Download01Icon}
                    data-icon="download"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
              >
                {t("browser.menu.saveScreenshot")}
              </DropdownItem>
            )}
            {onOpenHtmlFile && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                onClick={runAndClose(onOpenHtmlFile)}
                dataTestId="browser-open-html-file"
                icon={
                  <HugeiconsIcon
                    icon={FolderOpenIcon}
                    data-icon="folder-open"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
              >
                {t("browser.menu.openHtmlFile")}
              </DropdownItem>
            )}
            {onImportCookies && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                onClick={runAndClose(onImportCookies)}
                dataTestId="browser-import-cookies"
                icon={
                  <HugeiconsIcon
                    icon={CookieIcon}
                    data-icon="cookie"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
              >
                {t("browserCookieImport.action")}
              </DropdownItem>
            )}
            {hasFileActions && hasDevTools && (
              <div
                role="separator"
                className={DROPDOWN_CLASSES.menuGroupSeparator}
              />
            )}
            {onOpenNativeDevTools && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                onClick={runAndClose(onOpenNativeDevTools)}
                disabled={!canOpenNativeDevTools}
                dataTestId="browser-open-native-devtools"
                icon={
                  <HugeiconsIcon
                    icon={CodeXmlIcon}
                    data-icon="code"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
              >
                {t("tooltips.openNativeDevTools")}
              </DropdownItem>
            )}
          </ActionMenuSurface>,
          document.body
        )}
    </>
  );
}

export default BrowserUrlBarMoreMenu;
