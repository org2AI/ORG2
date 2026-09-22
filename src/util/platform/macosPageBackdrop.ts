/**
 * Back the window's opaque page surface with a native layer on macOS, so a
 * window resize shows the page colour instead of translucent vibrancy.
 *
 * WebKit on macOS 14+ composites web content in the UI process and sends each
 * new view size to the WebContent process without waiting for it to paint:
 * the window resizes at once and the page catches up one or more frames
 * later. Until it does, the band at the trailing edges shows what sits under
 * the transparent webview — the vibrancy material and the root tint
 * (`macosRootTint.ts`) — a see-through strip beside a page that is opaque.
 *
 * Opaque page surfaces register here (`useMacosPageBackdropSurface`). The
 * most recently registered one with an area is measured — its insets from the
 * viewport edges and the colour it paints — and handed to
 * `set_window_page_backdrop`. Rust keeps an opaque layer of that colour under
 * that region and reveals it only while the window resizes (see
 * `app_window::page_backdrop`): under the page it is covered, and the strip
 * shows the page colour. Translucent surfaces are never mirrored, because the
 * layer would show through them.
 *
 * Geometry is re-measured from a ResizeObserver, where layout is already
 * clean; the colour is re-read on the same measurement and on the theme and
 * skin changes that recolour a surface without resizing it. Only changes cross
 * the IPC boundary: during a window resize the insets stay put, so nothing is
 * sent.
 */
import { hasMacWindowChrome } from "@src/config/windowChromeRadius";
import { parseCssColor } from "@src/util/platform/macosRootTint";

/** Alpha below which a surface is not mirrored: the layer would show through. */
const OPAQUE_ALPHA_MIN = 0.999;

/** Insets closer than this (CSS px) count as unchanged. */
const INSET_EPSILON = 0.01;

/** A page backdrop as `set_window_page_backdrop` takes it. */
export interface PageBackdrop {
  /** Top, right, bottom and left distance to the viewport edges, in CSS px. */
  insets: [number, number, number, number];
  /** Opaque sRGB colour, components in `0..=1`. */
  color: [number, number, number, number];
}

interface SurfaceRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

/**
 * The backdrop for a surface at `rect` painting `backgroundColor` (a computed
 * value), or `null` when it has no area or is not opaque.
 */
export function resolvePageBackdrop(
  rect: SurfaceRect,
  viewport: ViewportSize,
  backgroundColor: string
): PageBackdrop | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const color = parseCssColor(backgroundColor);
  if (!color || color.a < OPAQUE_ALPHA_MIN) return null;
  const inset = (distance: number) => Math.max(0, distance);
  return {
    insets: [
      inset(rect.top),
      inset(viewport.width - rect.right),
      inset(viewport.height - rect.bottom),
      inset(rect.left),
    ],
    color: [color.r, color.g, color.b, 1],
  };
}

function isSameBackdrop(
  a: PageBackdrop | null,
  b: PageBackdrop | null
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.insets.every(
      (inset, index) => Math.abs(inset - b.insets[index]) < INSET_EPSILON
    ) && a.color.every((component, index) => component === b.color[index])
  );
}

const surfaces: HTMLElement[] = [];
let resizeObserver: ResizeObserver | null = null;

/** Latest measurement: what the native layer should become. */
let desired: PageBackdrop | null = null;
/**
 * What the native layer was last set to; `undefined` until the first push in
 * this page load, so a reload also replaces a layer left by the previous one.
 */
let pushed: PageBackdrop | null | undefined;
let pending: Promise<void> | null = null;

function measure(): PageBackdrop | null {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  for (let index = surfaces.length - 1; index >= 0; index -= 1) {
    const surface = surfaces[index];
    if (!surface.isConnected) continue;
    const backdrop = resolvePageBackdrop(
      surface.getBoundingClientRect(),
      viewport,
      getComputedStyle(surface).backgroundColor
    );
    if (backdrop) return backdrop;
  }
  return null;
}

/**
 * Send `desired` if it differs from what was last sent. Coalescing: a change
 * that lands while a push is in flight is picked up by the same loop, so the
 * native layer always ends on the latest measurement. Never rejects.
 */
function flush(): void {
  if (pending) return;
  pending = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      while (pushed === undefined || !isSameBackdrop(desired, pushed)) {
        const target = desired;
        await invoke("set_window_page_backdrop", {
          insets: target?.insets ?? null,
          color: target?.color ?? null,
        });
        pushed = target;
      }
    } catch {
      // Non-Tauri environment or the window is closing. Forget what native
      // holds so the next change is sent in full.
      pushed = undefined;
    } finally {
      pending = null;
    }
  })();
}

function remeasure(): void {
  desired = measure();
  flush();
}

/**
 * Register an opaque page surface of this window. Returns the unregister
 * function. A no-op outside a macOS window.
 */
export function registerMacosPageBackdropSurface(
  surface: HTMLElement
): () => void {
  if (typeof document === "undefined" || !hasMacWindowChrome()) {
    return () => undefined;
  }
  surfaces.push(surface);
  if (typeof ResizeObserver === "undefined") {
    remeasure();
  } else {
    resizeObserver ??= new ResizeObserver(remeasure);
    // Observation starts with a callback once layout has run, which does the
    // first measurement without forcing layout here.
    resizeObserver.observe(surface);
  }

  return () => {
    const index = surfaces.lastIndexOf(surface);
    if (index < 0) return;
    surfaces.splice(index, 1);
    if (!surfaces.includes(surface)) resizeObserver?.unobserve(surface);
    remeasure();
  };
}

/**
 * Re-measure after something recoloured the page without resizing it (a
 * theme or skin change). Fire-and-forget: never throws, and a no-op outside a
 * macOS window.
 */
export function syncMacosPageBackdrop(): void {
  if (typeof document === "undefined" || !hasMacWindowChrome()) return;
  remeasure();
}

/** Test-only: resolves once the push in flight, if any, has settled. */
export function settleMacosPageBackdropForTests(): Promise<void> {
  return pending ?? Promise.resolve();
}

/** Test-only: forget every surface and what native holds. */
export function resetMacosPageBackdropForTests(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
  surfaces.length = 0;
  desired = null;
  pushed = undefined;
  pending = null;
}
