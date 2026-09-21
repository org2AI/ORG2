import type { PollingVisibilitySource } from "./visibilityAwarePoller";

/** Own a presentation timer; hidden documents retain no timer. Wall-clock
 * consumers refresh once on return so suspended time is never lost. */
export function startVisibilityAwareInterval(
  source: PollingVisibilitySource,
  tick: () => void,
  intervalMs: number,
  onSuspend: () => void = () => {}
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let visible = source.visibilityState !== "hidden";
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    onSuspend();
  };
  const start = () => {
    timer = setInterval(tick, intervalMs);
  };
  const onVisibility = () => {
    const nextVisible = source.visibilityState !== "hidden";
    if (visible === nextVisible) return;
    visible = nextVisible;
    stop();
    if (visible) {
      tick();
      start();
    }
  };
  source.addEventListener("visibilitychange", onVisibility);
  if (visible) start();
  return () => {
    stop();
    source.removeEventListener("visibilitychange", onVisibility);
  };
}
