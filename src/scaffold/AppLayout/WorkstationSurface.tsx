import React, { useLayoutEffect, useRef, useState } from "react";

import FloatingWindowResizeHandles from "@src/components/FloatingWindow/ResizeHandles";
import { animateWindowBounds } from "@src/components/FloatingWindow/animateWindowBounds";
import { useWindowDrag } from "@src/components/FloatingWindow/useWindowDrag";
import {
  fitPinnedWindow,
  pinWindow,
} from "@src/components/FloatingWindow/windowGeometry";
import { WorkstationTrailHeader } from "@src/components/layout/blocks";
import { WORKSTATION_TRAIL_SURFACE_CLASS } from "@src/components/layout/tokens/workstationTrailTokens";
import { WEBVIEW_LAYOUT_CHANGED_EVENT } from "@src/hooks/platform/useInlineWebview/webviewLayoutEvents";

interface WorkstationSurfaceProps {
  floating: boolean;
  fullscreen?: boolean;
  appearance?: "station" | "trail";
  visible: boolean;
  dockStyle: React.CSSProperties;
  dockClassName: string;
  header: React.ReactNode;
  headerTitle?: React.ReactNode;
  label: string;
  children?: React.ReactNode;
  onTransitionEnd?: React.TransitionEventHandler<HTMLDivElement>;
  findScopeSwitching?: boolean;
}

/**
 * One stable host in both layouts. Moving children between a dock and a Portal
 * would recreate editor/terminal/browser owners. Only this shell's geometry
 * changes; imperative floating geometry is remembered while docked.
 */
export function WorkstationSurface({
  floating,
  fullscreen = false,
  appearance = "station",
  visible,
  dockStyle,
  dockClassName,
  header,
  headerTitle,
  label,
  children,
  onTransitionEnd,
  findScopeSwitching,
}: WorkstationSurfaceProps) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<
    Partial<
      Record<"station" | "trail", { css: string; x?: string; y?: string }>
    >
  >({});
  const [minimum, setMinimum] = useState({ width: 480, height: 320 });
  const isFullscreen = floating && fullscreen;
  const drag = useWindowDrag(floating && visible && !isFullscreen);
  const previousBounds = useRef<{
    rect: DOMRect;
    fullscreen: boolean;
    appearance: "station" | "trail";
  } | null>(null);
  const cancelAnimation = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !floating) return;
    const geometries = geometryRef.current;
    const geometry = geometries[appearance];
    if (isFullscreen) {
      // Fullscreen is temporary presentation, never remembered floating geometry.
      // Percentages keep the same host fitted to its existing layout container.
      Object.assign(surface.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%",
        maxWidth: "none",
        maxHeight: "none",
        margin: "0",
      });
    } else if (geometry) {
      surface.style.cssText = geometry.css;
      surface.dataset.fwPinned = "true";
      surface.dataset.fwOffsetX = geometry.x ?? "0";
      surface.dataset.fwOffsetY = geometry.y ?? "0";
    } else if (appearance === "trail") {
      // Let shared drag/resize geometry override the initial width.
      surface.style.width = "640px";
    }
    return () => {
      previousBounds.current = {
        rect: surface.getBoundingClientRect(),
        fullscreen: isFullscreen,
        appearance,
      };
      cancelAnimation.current?.();
      // Read the last imperative geometry, never a docked layout rect: React
      // may already have changed classes when this cleanup runs.
      if (!isFullscreen) {
        geometries[appearance] = {
          css: surface.style.cssText,
          x: surface.dataset.fwOffsetX,
          y: surface.dataset.fwOffsetY,
        };
      }
      surface.style.cssText = "";
      delete surface.dataset.fwPinned;
      delete surface.dataset.fwOffsetX;
      delete surface.dataset.fwOffsetY;
    };
  }, [floating, appearance, isFullscreen]);

  useLayoutEffect(() => {
    const bounds = boundsRef.current;
    const surface = surfaceRef.current;
    if (!floating || !visible || !bounds || !surface) return;
    let frame: number | null = null;
    const notify = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        window.dispatchEvent(new CustomEvent(WEBVIEW_LAYOUT_CHANGED_EVENT));
      });
    };
    let lastBounds: { width: number; height: number } | null = null;
    const fit = () => {
      const rect = bounds.getBoundingClientRect();
      // The observer's initial delivery must not interrupt a just-started
      // fullscreen animation or pin its intermediate dimensions as saved state.
      if (lastBounds?.width === rect.width && lastBounds.height === rect.height)
        return;
      lastBounds = { width: rect.width, height: rect.height };
      cancelAnimation.current?.();
      setMinimum({
        width: Math.min(480, Math.max(0, rect.width - 24)),
        height: Math.min(320, Math.max(0, rect.height - 24)),
      });
      if (!isFullscreen) {
        // Also pin a dragged fluid window before bounds shrink; otherwise only
        // manually resized windows would be brought back onto the screen.
        pinWindow(surface);
        fitPinnedWindow(surface, 0, 0);
      }
      notify();
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(bounds);
    const movement = new MutationObserver(notify);
    movement.observe(surface, { attributes: true, attributeFilter: ["style"] });
    return () => {
      resize.disconnect();
      movement.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [floating, visible, appearance, isFullscreen]);

  useLayoutEffect(() => {
    const previous = previousBounds.current;
    previousBounds.current = null;
    const surface = surfaceRef.current;
    if (
      surface &&
      floating &&
      visible &&
      previous &&
      previous.appearance === appearance &&
      previous.fullscreen !== isFullscreen
    ) {
      cancelAnimation.current = animateWindowBounds(
        surface,
        previous.rect,
        () => {
          window.dispatchEvent(new CustomEvent(WEBVIEW_LAYOUT_CHANGED_EVENT));
        }
      );
    }
    return () => {
      cancelAnimation.current?.();
      cancelAnimation.current = null;
    };
  }, [floating, visible, appearance, isFullscreen]);

  return (
    <div
      ref={boundsRef}
      className={
        floating
          ? `pointer-events-none absolute inset-0 z-60 flex justify-end p-3 ${appearance === "trail" ? "items-start" : "items-end"}`
          : dockClassName
      }
      style={floating ? undefined : dockStyle}
      aria-hidden={!visible}
      inert={!visible}
      data-workbench-surface
      data-find-scope-switching={findScopeSwitching}
      onTransitionEnd={onTransitionEnd}
      data-workstation-presentation={floating ? "floating" : "docked"}
    >
      <div
        ref={surfaceRef}
        data-draggable-window={floating && !isFullscreen ? true : undefined}
        data-workstation-fullscreen={isFullscreen || undefined}
        data-workstation-surface
        role={floating ? "region" : undefined}
        aria-label={floating ? label : undefined}
        className={
          floating
            ? `pointer-events-auto relative flex h-full max-h-[700px] max-w-full min-w-0 ${appearance === "trail" ? WORKSTATION_TRAIL_SURFACE_CLASS : "w-[900px] flex-col overflow-hidden rounded-xl border border-border-2 bg-bg-2 shadow-2xl"} ${visible ? "" : "invisible"}`
            : "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
        }
      >
        <div
          style={floating ? undefined : { display: "none" }}
          onPointerDown={drag}
          className={
            appearance === "trail"
              ? `shrink-0 select-none ${isFullscreen ? "" : "cursor-grab"}`
              : `flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border-2 px-2 select-none ${isFullscreen ? "" : "cursor-grab"}`
          }
        >
          {appearance === "trail" ? (
            <WorkstationTrailHeader
              title={headerTitle == null ? label : null}
              actions={header}
            >
              {headerTitle}
            </WorkstationTrailHeader>
          ) : (
            <>
              <span className="truncate text-xs font-medium text-text-2">
                {label}
              </span>
              {header}
            </>
          )}
        </div>
        <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
        {floating && visible && !isFullscreen && (
          <FloatingWindowResizeHandles
            minWidth={minimum.width}
            minHeight={minimum.height}
          />
        )}
      </div>
    </div>
  );
}
