import { atom, useAtom } from "jotai";
import { createContext, useCallback, useLayoutEffect, useRef } from "react";

export const launchpadTransitionSourceAtom = atom<HTMLElement | null>(null);
export const SpotlightTransitionRefContext = createContext<
  ((element: HTMLDivElement | null) => void) | undefined
>(undefined);

export function getLaunchpadTransform(source: DOMRect, panel: DOMRect) {
  return `translate(${source.left - panel.left}px, ${source.top - panel.top}px) scale(${source.width / panel.width}, ${source.height / panel.height})`;
}

/** One bounded browser animation; no React updates on animation frames. */
export function animateLaunchpadTransition(
  panel: HTMLElement,
  source: HTMLElement,
  done: () => void
): () => void {
  const target = source.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  if (
    document.hidden ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    !panel.animate ||
    !source.isConnected ||
    target.width <= 0 ||
    target.height <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    done();
    return () => undefined;
  }

  // Animate a visual snapshot without changing the live search layout.
  const snapshot = panel.cloneNode(true) as HTMLElement;
  snapshot.removeAttribute("data-spotlight-container");
  snapshot.setAttribute("aria-hidden", "true");
  snapshot.inert = true;
  Object.assign(snapshot.style, {
    position: "fixed",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    transform: "none",
    transformOrigin: "top left",
    pointerEvents: "none",
    overflow: "hidden",
  });
  document.body.append(snapshot);
  const transform = getLaunchpadTransform(target, bounds);
  const frames = [
    { transform, opacity: 0.25, borderRadius: "999px" },
    { transform: "none", opacity: 1, borderRadius: "16px" },
  ];
  const animation = snapshot.animate(frames, {
    duration: 240,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    fill: "both",
  });
  const previousOpacity = panel.style.opacity;
  panel.style.opacity = "0";
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    document.removeEventListener("visibilitychange", onVisibility);
    animation.cancel();
    snapshot.remove();
    panel.style.opacity = previousOpacity;
    done();
  };
  const onVisibility = () => {
    if (document.hidden) finish();
  };
  document.addEventListener("visibilitychange", onVisibility);
  void animation.finished.then(finish, finish);
  return finish;
}

export function useLaunchpadTransition(open: boolean) {
  const [source, setSource] = useAtom(launchpadTransitionSourceAtom);
  const entered = useRef(false);
  const cancel = useRef<(() => void) | undefined>(undefined);
  const register = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element || !source || entered.current) return;
      entered.current = true;
      cancel.current?.();
      source.setAttribute("data-spotlight-source-active", "true");
      cancel.current = animateLaunchpadTransition(
        element,
        source,
        () => undefined
      );
    },
    [source]
  );

  useLayoutEffect(() => {
    if (open) return;
    entered.current = false;
    cancel.current?.();
    source?.removeAttribute("data-spotlight-source-active");
    setSource(null);
  }, [open, source, setSource]);

  useLayoutEffect(
    () => () => {
      cancel.current?.();
      source?.removeAttribute("data-spotlight-source-active");
    },
    [source]
  );

  useLayoutEffect(() => () => setSource(null), [setSource]);

  return register;
}
