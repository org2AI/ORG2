import { createLogger } from "@src/hooks/logger";

const logger = createLogger("weeklyQuotaScheduler");

export const QUOTA_SAMPLE_INTERVAL_MS = 60 * 60 * 1000;

/** One disposable timer; no overlap, catch-up loops or hidden/offline work. */
export function startWeeklyQuotaScheduler(
  run: (isActive: () => boolean) => Promise<void>,
  onError: () => void,
  subscribeChanges?: (wake: () => void) => () => void
): () => void {
  let stopped = false;
  let running = false;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const isActive = () =>
    !stopped && document.visibilityState !== "hidden" && navigator.onLine;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const tick = async () => {
    clear();
    if (!isActive() || running) return;
    running = true;
    try {
      await run(isActive);
    } catch {
      if (!stopped) onError();
    } finally {
      running = false;
      if (isActive())
        timer = setTimeout(runTick, rerun ? 0 : QUOTA_SAMPLE_INTERVAL_MS);
      rerun = false;
    }
  };
  const runTick = () => {
    void tick().catch(() => {
      // Provider failures are handled inside tick; contain callback failures too.
      logger.warn("Weekly quota scheduler callback failed");
    });
  };
  const wake = () => {
    clear();
    if (running) {
      rerun = true;
      return;
    }
    if (isActive()) runTick();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  window.addEventListener("offline", wake);
  const unsubscribe = subscribeChanges?.(wake);
  runTick();
  return () => {
    stopped = true;
    unsubscribe?.();
    clear();
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", wake);
  };
}
