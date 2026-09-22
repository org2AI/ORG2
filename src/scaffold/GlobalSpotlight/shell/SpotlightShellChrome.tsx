/**
 * SpotlightShellChrome
 *
 * Low-level chrome for SpotlightShell: simple panel + optional portal +
 * backdrop + content-area-centered positioning + footer slot beneath the
 * panel. Horizontal centering excludes the docked layout sidebar and the
 * focused-chat workstation trail, so the spotlight sits over the visible
 * content rather than the full viewport.
 *
 * This is a direct merge of the previous SelectorContainer + SpotlightPortal
 * layer. Only consumed by SpotlightShell; palettes never see this component.
 */
import { useAtomValue } from "jotai";
import React, { useContext, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

import { CODEMIRROR_STYLE_NONCE } from "@src/features/CodeMirror/config/nonce";
import { useSettingValue } from "@src/hooks/settings/useSettings";
import { useOverlayLayer } from "@src/store/ui/overlayLayerAtom";
import {
  sidebarCollapsedAtom,
  sidebarWidthAtom,
} from "@src/store/ui/sidebarAtom";
import { spotlightPlacementAtom } from "@src/store/ui/uiAtom";
import {
  getSpotlightAnchorStyle,
  getSpotlightSidebarInset,
  measureSpotlightTrailInset,
} from "@src/util/ui/spotlightAnchor";

import { SPOTLIGHT_CLASSES, SPOTLIGHT_CONFIG } from "../constants";
import { SPOTLIGHT_STYLES } from "../styles";
import { SpotlightTransitionRefContext } from "../useLaunchpadTransition";

// ============ TYPES ============

export interface SpotlightShellChromeProps {
  isOpen: boolean;
  onClose: () => void;
  asPortal: boolean;
  stopPropagation: boolean;
  width: number;
  footer: React.ReactNode;
  children: React.ReactNode;
}

// ============ COMPONENT ============

export const SpotlightShellChrome: React.FC<SpotlightShellChromeProps> = ({
  isOpen,
  onClose,
  asPortal,
  stopPropagation,
  width,
  footer,
  children,
}) => {
  const transitionRef = useContext(SpotlightTransitionRefContext);
  const inputHostRef = useRef<HTMLDivElement | null>(null);
  const spotlightPlacement = useAtomValue(spotlightPlacementAtom);
  const location = useLocation();
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const dimBackground = useSettingValue("general.spotlightDimBackground");

  const sidebarInset = getSpotlightSidebarInset(
    location.pathname,
    sidebarWidth,
    sidebarCollapsed
  );

  // The focused-chat workstation trail reserves width at the right edge of
  // the content area. Measured once per open — the backdrop prevents the
  // trail from changing while the spotlight is up.
  const trailInset = useMemo(
    () => (isOpen && asPortal ? measureSpotlightTrailInset() : 0),
    [isOpen, asPortal]
  );

  useOverlayLayer(isOpen && asPortal);

  // Bubble-phase escape handler (portal mode only — non-portal callers
  // expect the parent's focus trap to own escape).
  useEffect(() => {
    if (!isOpen || !asPortal) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, asPortal, onClose]);

  if (!isOpen) return null;

  const refocusInput = () => {
    // Try to refocus the first input inside the panel (palettes own their
    // own inputRef; the shell can't hold a typed ref to it).
    setTimeout(() => {
      const input =
        inputHostRef.current?.querySelector<HTMLInputElement>("input");
      input?.focus();
    }, 0);
  };

  const handlePanelClick = (event: React.MouseEvent) => {
    if (stopPropagation) event.stopPropagation();
    // Only refocus the default search input when clicking a non-interactive
    // dead zone. If the click landed on (or inside) a focusable element —
    // input, textarea, contenteditable, button, select, or a custom
    // interactive component — let the browser's native focus stand so that
    // embedded editors (e.g. the session creator composer) remain editable.
    const target = event.target as HTMLElement;
    const interactive = target.closest(
      "input, textarea, [contenteditable], button, select, a, [tabindex]"
    );
    if (!interactive) {
      refocusInput();
    }
  };

  const panel = (
    <div
      ref={inputHostRef}
      {...(footer == null ? { "data-spotlight-detail-anchor": true } : {})}
    >
      <div
        className={SPOTLIGHT_CLASSES.panel}
        style={{
          width: "100%",
          maxWidth: `${width}px`,
        }}
        onClick={handlePanelClick}
      >
        {children}
      </div>
    </div>
  );

  const shell =
    footer != null ? (
      <div data-spotlight-detail-anchor className="flex w-full flex-col gap-2">
        {panel}
        <div className="flex w-full justify-center" onClick={refocusInput}>
          {footer}
        </div>
      </div>
    ) : (
      panel
    );

  if (!asPortal) {
    return (
      <>
        <style nonce={CODEMIRROR_STYLE_NONCE}>{SPOTLIGHT_STYLES}</style>
        {shell}
      </>
    );
  }

  return createPortal(
    <>
      <style nonce={CODEMIRROR_STYLE_NONCE}>{SPOTLIGHT_STYLES}</style>
      <div
        className={dimBackground ? "spotlight-backdrop" : undefined}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: SPOTLIGHT_CONFIG.backdropZIndex,
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.stopPropagation();
            onClose();
          }
        }}
      />
      <div
        ref={transitionRef}
        data-spotlight-container
        style={{
          position: "fixed",
          top:
            spotlightPlacement === "center"
              ? "50%"
              : SPOTLIGHT_CONFIG.topOffset,
          ...getSpotlightAnchorStyle(width, sidebarInset, trailInset),
          transform:
            spotlightPlacement === "center"
              ? "translate(-50%, -50%)"
              : "translateX(-50%)",
          zIndex: SPOTLIGHT_CONFIG.containerZIndex,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {shell}
      </div>
    </>,
    document.body
  );
};
