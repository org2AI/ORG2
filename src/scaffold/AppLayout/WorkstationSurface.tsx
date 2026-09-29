import React, { useLayoutEffect, useRef, useState } from "react";

import FloatingWindowResizeHandles from "@src/components/FloatingWindow/ResizeHandles";
import { useWindowDrag } from "@src/components/FloatingWindow/useWindowDrag";
import {
  fitPinnedWindow,
  pinWindow,
} from "@src/components/FloatingWindow/windowGeometry";
import { WEBVIEW_FLOATING_LAYOUT_CHANGED_EVENT } from "@src/hooks/platform/useInlineWebview/webviewLayoutEvents";

interface WorkstationSurfaceProps {
  floating: boolean;
  visible: boolean;
  dockStyle: React.CSSProperties;
  dockClassName: string;
  header: React.ReactNode;
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
  visible,
  dockStyle,
  dockClassName,
  header,
  label,
  children,
  onTransitionEnd,
  findScopeSwitching,
}: WorkstationSurfaceProps) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<{ css: string; x?: string; y?: string } | null>(
    null
  );
  const [minimum, setMinimum] = useState({ width: 480, height: 320 });
  const drag = useWindowDrag(floating && visible);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !floating) return;
    if (geometryRef.current) {
      surface.style.cssText = geometryRef.current.css;
      surface.dataset.fwPinned = "true";
      surface.dataset.fwOffsetX = geometryRef.current.x ?? "0";
      surface.dataset.fwOffsetY = geometryRef.current.y ?? "0";
    }
    return () => {
      // Read the last imperative geometry, never a docked layout rect: React
      // may already have changed classes when this cleanup runs.
      geometryRef.current = {
        css: surface.style.cssText,
        x: surface.dataset.fwOffsetX,
        y: surface.dataset.fwOffsetY,
      };
      surface.style.cssText = "";
      delete surface.dataset.fwPinned;
      delete surface.dataset.fwOffsetX;
      delete surface.dataset.fwOffsetY;
    };
  }, [floating]);

  useLayoutEffect(() => {
    const bounds = boundsRef.current;
    const surface = surfaceRef.current;
    if (!floating || !visible || !bounds || !surface) return;
    let frame: number | null = null;
    const notify = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        window.dispatchEvent(
          new CustomEvent(WEBVIEW_FLOATING_LAYOUT_CHANGED_EVENT)
        );
      });
    };
    const fit = () => {
      const rect = bounds.getBoundingClientRect();
      setMinimum({
        width: Math.min(480, Math.max(0, rect.width - 24)),
        height: Math.min(320, Math.max(0, rect.height - 24)),
      });
      // Also pin a dragged fluid window before bounds shrink; otherwise only
      // manually resized windows would be brought back onto the screen.
      pinWindow(surface);
      fitPinnedWindow(surface, 0, 0);
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
  }, [floating, visible]);

  return (
    <div
      ref={boundsRef}
      className={
        floating
          ? "pointer-events-none absolute inset-0 z-60 flex items-end justify-end p-3"
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
        data-draggable-window={floating ? true : undefined}
        data-workstation-surface
        role={floating ? "region" : undefined}
        aria-label={floating ? label : undefined}
        className={
          floating
            ? `pointer-events-auto relative flex h-full max-h-[700px] w-[900px] max-w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border-2 bg-bg-2 shadow-2xl ${visible ? "" : "invisible"}`
            : "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
        }
      >
        <div
          style={floating ? undefined : { display: "none" }}
          onPointerDown={drag}
          className="flex h-8 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border-2 px-2 select-none"
        >
          <span className="truncate text-xs font-medium text-text-2">
            {label}
          </span>
          {header}
        </div>
        <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
        {floating && visible && (
          <FloatingWindowResizeHandles
            minWidth={minimum.width}
            minHeight={minimum.height}
          />
        )}
      </div>
    </div>
  );
}
