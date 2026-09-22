/**
 * WebUrlBar Component
 *
 * URL input bar for Browser's web browsing mode, similar to FileHeader in Code Editor.
 * Features:
 * - URL input with navigation
 * - Back/Forward buttons
 * - Reload button
 * - Loading indicator
 * - "..." menu: page color scheme, save screenshot, open a local HTML file,
 *   import cookies, native DevTools
 */
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { HeaderSectionSeparator } from "@src/components/HeaderSectionSeparator";
import Input from "@src/components/Input";
import {
  ToolbarTooltip,
  ToolbarTooltipPositionProvider,
} from "@src/components/KeyboardShortcut/ToolbarTooltip";
import {
  FILE_BAR_ROW_CLASSES,
  HEADER_ICON_SIZE,
} from "@src/config/workstation/tokens";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import {
  type WorkstationTabHeaderHost,
  usePublishWorkstationTabHeader,
} from "@src/hooks/tabHost/useWorkstationTabHeader";
import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Camera01Icon,
  Cancel01Icon,
  HugeiconsIcon,
  Loading03Icon,
  PenTool01Icon,
  PencilRulerIcon,
  Refresh04Icon,
} from "@src/icons";
import { BROWSER_URL_BAR_FOCUS_EVENT } from "@src/modules/WorkStation/Browser/shared/urlBarFocus";
import { normalizeBrowserInput } from "@src/util/url/browserUrl";
import { isLocalFileUrl } from "@src/util/url/localFileUrl";

import { BrowserUrlBarMoreMenu } from "./BrowserUrlBarMoreMenu";

// ============================================
// Types
// ============================================

interface WebUrlBarProps {
  /** Current URL */
  url: string;
  /** Whether the page is loading */
  isLoading?: boolean;
  /** Whether in incognito mode */
  isIncognito?: boolean;
  /** Called when user navigates to a new URL */
  onNavigate: (url: string) => void;
  /** Called when back button is clicked */
  onBack?: () => void;
  /** Called when forward button is clicked */
  onForward?: () => void;
  /** Called when reload button is clicked */
  onReload?: () => void;
  /** Called when stop button is clicked */
  onStop?: () => void;
  /** Whether back navigation is available */
  canGoBack?: boolean;
  /** Whether forward navigation is available */
  canGoForward?: boolean;
  /** Whether the active browser session owns a native webview. */
  hasActiveWebview?: boolean;
  /** Open native browser DevTools (Safari Inspector / Edge DevTools) */
  onOpenNativeDevTools?: () => void;
  /** Toggle the WorkStation Browser secondary DevTools pane. */
  onToggleDevToolsPane?: () => void;
  /** Whether the WorkStation Browser secondary DevTools pane is collapsed. */
  devToolsPaneCollapsed?: boolean;
  /** Capture the current page as an image and attach it to the chat input. */
  onScreenshot?: () => void;
  /** Whether a screenshot capture is currently in flight. */
  isCapturingScreenshot?: boolean;
  /** Capture the current page and save it to a file the user picks. */
  onSaveScreenshot?: () => void;
  /** Pick a local HTML file and open it in this tab. */
  onOpenHtmlFile?: () => void;
  /** Open the "import cookies from your browser" flow. Hidden when omitted. */
  onImportCookies?: () => void;
  /** Whether the element inspector is currently active. */
  isInspectMode?: boolean;
  /** Toggle the element inspector (hover/click to select DOM nodes). */
  onToggleInspectMode?: () => void;
  /** Header host to publish into. Defaults to My Station Browser. */
  publishToHost?: WorkstationTabHeaderHost;
  /** Publish header content when not rendering inline. */
  publishEnabled?: boolean;
  /** Render directly instead of publishing into the Workstation tab header slot. */
  inline?: boolean;
}

// ============================================
// Helpers
// ============================================

/** After pointer leaves the URL toolbar, blur the input if still focused (inline webview does not take focus from the address field). */
const AUTO_BLUR_MS_AFTER_LEAVE = 2000;
const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const TEXT_DRAG_THRESHOLD_PX = 4;

interface UrlInputPointerState {
  startX: number;
  startY: number;
  moved: boolean;
  wasFocused: boolean;
}

// ============================================
// Component
// ============================================

export const WebUrlBar: React.FC<WebUrlBarProps> = memo(
  ({
    url,
    isLoading = false,
    isIncognito: _isIncognito = false,
    onNavigate,
    onBack,
    onForward,
    onReload,
    onStop,
    canGoBack = false,
    canGoForward = false,
    hasActiveWebview = true,
    onOpenNativeDevTools,
    onToggleDevToolsPane,
    devToolsPaneCollapsed = false,
    onScreenshot,
    isCapturingScreenshot = false,
    onSaveScreenshot,
    onOpenHtmlFile,
    onImportCookies,
    isInspectMode = false,
    onToggleInspectMode,
    publishToHost = "browser",
    publishEnabled = true,
    inline = false,
  }) => {
    const { t } = useTranslation();
    const [inputValue, setInputValue] = useState(url);
    const lastUrlRef = useRef(url);
    const inputRef = useRef<HTMLInputElement>(null);
    const autoBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFocusedRef = useRef(false);
    const pointerStateRef = useRef<UrlInputPointerState | null>(null);
    const pointerFocusRef = useRef(false);
    const tauriSelectAll = useTauriSelectAllShortcut();

    const clearAutoBlurTimer = useCallback(() => {
      if (autoBlurTimerRef.current !== null) {
        clearTimeout(autoBlurTimerRef.current);
        autoBlurTimerRef.current = null;
      }
    }, []);

    const selectInputText = useCallback(() => {
      const input = inputRef.current;
      if (!input) return;
      queueMicrotask(() => {
        input.select();
      });
    }, []);

    const focusAndSelectInput = useCallback(() => {
      clearAutoBlurTimer();
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      selectInputText();
    }, [clearAutoBlurTimer, selectInputText]);

    useEffect(() => {
      const handleFocusUrlBar = () => {
        focusAndSelectInput();
      };
      window.addEventListener(BROWSER_URL_BAR_FOCUS_EVENT, handleFocusUrlBar);
      return () => {
        window.removeEventListener(
          BROWSER_URL_BAR_FOCUS_EVENT,
          handleFocusUrlBar
        );
        clearAutoBlurTimer();
      };
    }, [clearAutoBlurTimer, focusAndSelectInput]);

    // Sync input with external URL changes (only when not focused)
    useEffect(() => {
      if (url !== lastUrlRef.current) {
        lastUrlRef.current = url;
        if (!isFocusedRef.current) {
          // Defer setState to avoid cascading renders within effect
          queueMicrotask(() => {
            setInputValue(url);
          });
        }
      }
    }, [url]);

    // Handle focus - select all text for keyboard/programmatic focus. Pointer
    // focus is handled on mouseup so drag-select can keep the native selection.
    const handleFocus = useCallback(() => {
      clearAutoBlurTimer();
      isFocusedRef.current = true;
      if (pointerFocusRef.current) return;
      selectInputText();
    }, [clearAutoBlurTimer, selectInputText]);

    // Handle blur - keep user's changes
    const handleBlur = useCallback(() => {
      clearAutoBlurTimer();
      isFocusedRef.current = false;
      pointerFocusRef.current = false;
      pointerStateRef.current = null;
    }, [clearAutoBlurTimer]);

    const handleInputMouseDown = useCallback(
      (event: React.MouseEvent<HTMLInputElement>) => {
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        clearAutoBlurTimer();
        pointerFocusRef.current = true;
        pointerStateRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          wasFocused: document.activeElement === event.currentTarget,
        };
      },
      [clearAutoBlurTimer]
    );

    const handleInputMouseMove = useCallback(
      (event: React.MouseEvent<HTMLInputElement>) => {
        const pointerState = pointerStateRef.current;
        if (!pointerState || pointerState.moved) return;

        const deltaX = Math.abs(event.clientX - pointerState.startX);
        const deltaY = Math.abs(event.clientY - pointerState.startY);
        if (
          deltaX > TEXT_DRAG_THRESHOLD_PX ||
          deltaY > TEXT_DRAG_THRESHOLD_PX
        ) {
          pointerState.moved = true;
        }
      },
      []
    );

    const handleInputMouseUp = useCallback(() => {
      const pointerState = pointerStateRef.current;
      pointerStateRef.current = null;
      pointerFocusRef.current = false;

      if (!pointerState) return;
      if (!pointerState.wasFocused && !pointerState.moved) {
        selectInputText();
      }
    }, [selectInputText]);

    const scheduleBlurAfterLeaveToolbar = useCallback(() => {
      clearAutoBlurTimer();
      autoBlurTimerRef.current = setTimeout(() => {
        autoBlurTimerRef.current = null;
        const input = inputRef.current;
        if (input && document.activeElement === input) {
          input.blur();
        }
      }, AUTO_BLUR_MS_AFTER_LEAVE);
    }, [clearAutoBlurTimer]);

    const handleToolbarMouseLeave = useCallback(() => {
      if (!isFocusedRef.current) return;
      scheduleBlurAfterLeaveToolbar();
    }, [scheduleBlurAfterLeaveToolbar]);

    const handleToolbarMouseEnter = useCallback(() => {
      clearAutoBlurTimer();
    }, [clearAutoBlurTimer]);

    // Handle navigation
    const handleNavigate = useCallback(() => {
      // A local page's address is already a complete URL; the web normalizer
      // only knows http(s) and would turn it into a search query.
      const typedUrl = inputValue.trim();
      const normalizedUrl = isLocalFileUrl(typedUrl)
        ? typedUrl
        : normalizeBrowserInput(inputValue);
      if (!normalizedUrl) return;

      setInputValue(normalizedUrl);
      lastUrlRef.current = normalizedUrl;
      onNavigate(normalizedUrl);
      inputRef.current?.blur();
    }, [inputValue, onNavigate]);

    // Handle key press — stop propagation to prevent global shortcuts from interfering
    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          handleNavigate();
        } else if (event.key === "Escape") {
          setInputValue(url);
          inputRef.current?.blur();
        }

        tauriSelectAll(event);
        if (event.defaultPrevented) {
          clearAutoBlurTimer();
          return;
        }

        // Stop all non-modifier keypresses from bubbling to global handlers
        // so typing in the URL bar doesn't accidentally trigger shortcuts
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          event.stopPropagation();
        }
      },
      [clearAutoBlurTimer, handleNavigate, tauriSelectAll, url]
    );

    const inputContainerClass =
      "relative flex h-7 min-w-0 flex-1 cursor-text items-center rounded-lg border border-transparent bg-transparent transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-primary-6 focus-within:bg-fill-2 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_30%,transparent)] [&:not(:focus-within):hover]:border-border-3 [&:not(:focus-within):hover]:bg-fill-2";
    const reloadControlLabel = isLoading
      ? t("common:actions.stop")
      : t("common:actions.reload");

    const headerContent = (
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-1.5"
        data-tauri-drag-region="false"
        style={NO_DRAG_STYLE}
        onMouseUp={handleInputMouseUp}
        onMouseLeave={handleToolbarMouseLeave}
        onMouseEnter={handleToolbarMouseEnter}
      >
        {/* Navigation Buttons (Back / Forward / Refresh) */}
        <div className="flex items-center gap-px">
          <ToolbarTooltip label={t("tooltips.goBack")}>
            <Button
              variant="tertiary"
              size="small"
              iconOnly
              onClick={onBack}
              disabled={!canGoBack}
              aria-label={t("tooltips.goBack")}
              icon={
                <HugeiconsIcon
                  icon={ArrowLeft02Icon}
                  data-icon="arrow-left"
                  size={HEADER_ICON_SIZE.md}
                />
              }
            />
          </ToolbarTooltip>
          <ToolbarTooltip label={t("tooltips.goForward")}>
            <Button
              variant="tertiary"
              size="small"
              iconOnly
              onClick={onForward}
              disabled={!canGoForward}
              aria-label={t("tooltips.goForward")}
              icon={
                <HugeiconsIcon
                  icon={ArrowRight02Icon}
                  data-icon="arrow-right"
                  size={HEADER_ICON_SIZE.md}
                />
              }
            />
          </ToolbarTooltip>
          <ToolbarTooltip label={reloadControlLabel}>
            <Button
              variant="tertiary"
              size="small"
              iconOnly
              onClick={isLoading ? onStop : onReload}
              disabled={!hasActiveWebview}
              aria-label={reloadControlLabel}
              icon={
                isLoading ? (
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    data-icon="x"
                    size={HEADER_ICON_SIZE.sm}
                  />
                ) : (
                  <HugeiconsIcon
                    icon={Refresh04Icon}
                    data-icon="refresh-cw"
                    size={HEADER_ICON_SIZE.sm}
                  />
                )
              }
            />
          </ToolbarTooltip>
        </div>

        <HeaderSectionSeparator />

        {/* URL Input Container */}
        <div
          className={inputContainerClass}
          data-tauri-drag-region="false"
          style={NO_DRAG_STYLE}
          onClick={() => {
            if (!isFocusedRef.current) {
              inputRef.current?.focus();
            }
          }}
        >
          {/* Input - keep real text selectable in both focused and unfocused states. */}
          <Input
            appearance="bare"
            size="small"
            autoHeight
            className="min-w-0 flex-1 [&>.input-inner]:border-0!"
            inputStyle={{
              ...NO_DRAG_STYLE,
              height: 28,
              fontSize: 14,
              padding: "0 12px",
            }}
            ref={inputRef}
            type="text"
            value={inputValue}
            aria-label="Browser URL"
            data-browser-url-bar-input
            data-testid="browser-url-bar-input"
            data-tauri-drag-region="false"
            draggable={false}
            onChange={(_value, event) => setInputValue(event.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onMouseDown={handleInputMouseDown}
            onMouseMove={handleInputMouseMove}
            onMouseUp={handleInputMouseUp}
            placeholder={t("placeholders.enterUrlOrSearch")}
            // A shown address sits centered; focusing it (editing) or an empty
            // bar with its placeholder keeps the usual left alignment.
            inputClassName="relative z-10 h-7 min-w-0 flex-1 border-none bg-transparent px-3 text-[14px] text-text-1 outline-none select-text placeholder:text-text-3 [&:not(:focus):not(:placeholder-shown)]:text-center"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>

        {(onToggleInspectMode ||
          onScreenshot ||
          onOpenNativeDevTools ||
          onToggleDevToolsPane ||
          onSaveScreenshot ||
          onOpenHtmlFile) && (
          <div className="flex items-center gap-px">
            {onToggleInspectMode && (
              <ToolbarTooltip
                label={t(
                  isInspectMode
                    ? "tooltips.disableInspectMode"
                    : "tooltips.enableInspectMode"
                )}
              >
                <Button
                  variant="tertiary"
                  size="small"
                  iconOnly
                  onClick={onToggleInspectMode}
                  disabled={!hasActiveWebview}
                  aria-label={t(
                    isInspectMode
                      ? "tooltips.disableInspectMode"
                      : "tooltips.enableInspectMode"
                  )}
                  className={isInspectMode ? "bg-fill-2! text-primary-6!" : ""}
                  icon={
                    <HugeiconsIcon
                      icon={PenTool01Icon}
                      data-icon="pen-tool"
                      size={HEADER_ICON_SIZE.sm}
                    />
                  }
                />
              </ToolbarTooltip>
            )}

            {onScreenshot && (
              <ToolbarTooltip label={t("tooltips.captureScreenshot")}>
                <Button
                  variant="tertiary"
                  size="small"
                  iconOnly
                  onClick={onScreenshot}
                  disabled={isCapturingScreenshot}
                  aria-label={t("tooltips.captureScreenshot")}
                  icon={
                    isCapturingScreenshot ? (
                      <HugeiconsIcon
                        icon={Loading03Icon}
                        data-icon="loader-2"
                        size={HEADER_ICON_SIZE.md}
                        className="animate-spin"
                      />
                    ) : (
                      <HugeiconsIcon
                        icon={Camera01Icon}
                        data-icon="camera"
                        size={HEADER_ICON_SIZE.md}
                      />
                    )
                  }
                />
              </ToolbarTooltip>
            )}

            {onToggleDevToolsPane && (
              <ToolbarTooltip
                label={
                  devToolsPaneCollapsed
                    ? t("sessions:titleBar.showDevTools")
                    : t("sessions:titleBar.hideDevTools")
                }
              >
                <Button
                  variant="tertiary"
                  size="small"
                  iconOnly
                  className={
                    devToolsPaneCollapsed ? "" : "bg-fill-2! text-primary-6!"
                  }
                  onClick={onToggleDevToolsPane}
                  aria-pressed={!devToolsPaneCollapsed}
                  aria-label={
                    devToolsPaneCollapsed
                      ? t("sessions:titleBar.showDevTools")
                      : t("sessions:titleBar.hideDevTools")
                  }
                  icon={
                    <HugeiconsIcon
                      icon={PencilRulerIcon}
                      data-icon="pencil-ruler"
                      size={HEADER_ICON_SIZE.sm}
                      strokeWidth={1.75}
                    />
                  }
                />
              </ToolbarTooltip>
            )}

            <BrowserUrlBarMoreMenu
              onSaveScreenshot={onSaveScreenshot}
              canSaveScreenshot={hasActiveWebview && !isCapturingScreenshot}
              onOpenHtmlFile={onOpenHtmlFile}
              onImportCookies={onImportCookies}
              onOpenNativeDevTools={onOpenNativeDevTools}
              canOpenNativeDevTools={hasActiveWebview}
            />
          </div>
        )}
      </div>
    );

    // The native webview sits right under this bar and paints over any
    // tooltip that opens downward, so this toolbar's tooltips open upward.
    const header = (
      <ToolbarTooltipPositionProvider value="top">
        {headerContent}
      </ToolbarTooltipPositionProvider>
    );

    usePublishWorkstationTabHeader({
      host: publishToHost,
      content: header,
      enabled: publishEnabled && !inline,
    });

    if (inline) {
      return <div className={FILE_BAR_ROW_CLASSES}>{header}</div>;
    }

    return null;
  }
);

WebUrlBar.displayName = "WebUrlBar";

export default WebUrlBar;
