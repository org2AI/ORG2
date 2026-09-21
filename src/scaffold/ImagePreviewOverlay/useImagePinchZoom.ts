import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

type ScaleEvent = Event & { scale: number };

/** Scoped to the mounted image; ordinary wheel scrolling remains native. */
export function useImagePinchZoom(
  viewport: RefObject<HTMLDivElement | null>,
  source: string | null,
  zoom: number,
  onZoom: (value: number) => void
) {
  const latestZoom = useRef(zoom);
  useLayoutEffect(() => {
    latestZoom.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !source) return;
    let frame: number | null = null;
    let gestureStartZoom: number | null = null;
    const schedule = (value: number) => {
      if (!Number.isFinite(value)) return;
      latestZoom.current = Math.max(25, Math.min(400, value));
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        onZoom(Math.round(latestZoom.current));
      });
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      // WebKit can also deliver wheel events during its native gesture stream.
      if (gestureStartZoom !== null) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1;
      const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
      schedule(latestZoom.current * Math.exp(-delta * 0.01));
    };
    const start = (event: Event) => {
      event.preventDefault();
      gestureStartZoom = latestZoom.current;
    };
    const change = (event: Event) => {
      event.preventDefault();
      const scale = (event as ScaleEvent).scale;
      if (gestureStartZoom !== null && Number.isFinite(scale) && scale > 0) {
        schedule(gestureStartZoom * scale);
      }
    };
    const end = (event: Event) => {
      event.preventDefault();
      gestureStartZoom = null;
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", start, { passive: false });
    element.addEventListener("gesturechange", change, { passive: false });
    element.addEventListener("gestureend", end, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", start);
      element.removeEventListener("gesturechange", change);
      element.removeEventListener("gestureend", end);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [viewport, source, onZoom]);
}
