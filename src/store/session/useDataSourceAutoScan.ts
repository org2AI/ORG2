/**
 * useDataSourceAutoScan
 *
 * App-wide scheduler that keeps external-history sources fresh. Mounted once in
 * AppBootstrap so it runs regardless of whether the Data Sources panel is open.
 *
 * On app startup it scans only enabled, non-manual importable sources whose
 * persisted cadence is due (including sources that have never been scanned).
 * Sources without a store receive only a cheap presence probe every 30 minutes;
 * when a store appears, its importer runs immediately. A successful full scan
 * refreshes the canonical session roster only when source data changed since
 * the roster's last reload — detected via the rescan's own writes OR a drift
 * in the per-source cache signature (covering writes other surfaces' syncs
 * made between ticks).
 * A source whose importer fails (e.g. a store the OS refuses to open) is
 * isolated: the sources that did scan are still stamped and reloaded, while
 * the failing one is left unstamped and retried on its own doubling backoff.
 * Sources set to "manual" are never auto-scanned or presence-probed, including
 * at startup.
 *
 * Config is read straight from the shared store on each tick, so the interval is
 * armed once and always sees the latest values without re-arming. Hidden windows
 * pause by default; an explicit app-wide background-upload demand keeps one
 * low-frequency timer alive and catches up immediately when it is enabled.
 *
 * Only the main window arms the scheduler (`isMainAppWindow`): secondary OS
 * windows (detached session windows) mount the same AppBootstrap, and a second
 * scan cadence per window would just duplicate rescans against the same
 * backend cache.
 */
import { atom } from "jotai";
import { useEffect } from "react";

import {
  IMPORTED_HISTORY_SOURCE_DESCRIPTORS,
  externalCliSourceProbe,
  externalHistoryRescanSources,
  splitScanSourcesByOutcome,
} from "@src/api/tauri/externalHistory";
import { createLogger } from "@src/hooks/logger";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import {
  isWindowFocused,
  onWindowFocusRegained,
} from "@src/util/core/windowFocus";
import { isMainAppWindow } from "@src/util/platform/tauri/windowIdentity";

import {
  type DataSourceConfig,
  type DataSourceConfigMap,
  type DataSourcePresence,
  type DataSourceScanFailure,
  FREQUENCY_INTERVAL_MS,
  type ScanFrequency,
  dataSourceConfigAtom,
  dataSourceGlobalFrequencyAtom,
  dataSourcePresenceAtom,
  dataSourceRosterSignaturesAtom,
  dataSourceScanFailureAtom,
  effectiveFrequency,
  externalHistoryBackgroundScanEnabledAtom,
  externalSessionsEnabledAtom,
  getSourceConfig,
  reduceDataSourceScanFailures,
} from "./dataSourceConfigAtom";
import { loadSessionRoster } from "./sessionAtom/loaders";

const logger = createLogger("DataSourceAutoScan");

// While the window is unfocused, every source's effective cadence is stretched
// to at least this floor (mirrors the backend git poller's focus-adaptive
// polling): rescans + the sidebar reload they trigger are wasted while nobody
// is looking. Regaining focus runs a pass immediately, so anything that came
// due in the background catches up right away.
const UNFOCUSED_SCAN_INTERVAL_MS = 10 * 60_000;

/** Cadence for refreshing the lightweight store-presence snapshot. */
const SOURCE_PRESENCE_PROBE_INTERVAL_MS = 30 * 60_000;
const FAILED_SCAN_RETRY_MS = 30_000;
// 2 ** 16 * 30s already exceeds every cadence; the cap only keeps the
// exponent finite for a source that stays broken for weeks.
const MAX_FAILED_SCAN_BACKOFF_DOUBLINGS = 16;

// Runtime-only, per-store retry deadlines. Never convert a failed probe into
// a negative presence result or persist transient failures as user policy.
export const dataSourceProbeRetryAtAtom = atom<Record<string, number>>({});

let autoScanInFlight: Promise<void> | null = null;

async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = {
          status: "fulfilled",
          value: await mapper(items[index]!),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      worker
    )
  );
  return results;
}

/**
 * When a source's importer should next run. A healthy source follows its
 * cadence from `lastScannedAt`. A failing source is never stamped, so without
 * its own deadline it would stay perpetually due and pull the scheduler into
 * a tight loop; it retries on a doubling backoff from its last attempt
 * instead — quickly at first for transient errors, then never more often
 * than the cadence it would have had while healthy.
 */
function nextSourceScanDeadline(
  cfg: DataSourceConfig,
  failure: DataSourceScanFailure | undefined,
  effectiveInterval: number,
  now: number
): number {
  if (failure) {
    const backoff =
      FAILED_SCAN_RETRY_MS *
      2 ** Math.min(failure.failures - 1, MAX_FAILED_SCAN_BACKOFF_DOUBLINGS);
    return failure.lastAttemptAt + Math.min(effectiveInterval, backoff);
  }
  return cfg.lastScannedAt == null
    ? now
    : cfg.lastScannedAt + effectiveInterval;
}

export function nextDataSourceAutoScanDelay(
  now: number,
  focused: boolean,
  enabled: boolean,
  cfgMap: DataSourceConfigMap,
  previousPresence: Record<string, DataSourcePresence>,
  global: ScanFrequency,
  probeRetryAt: Record<string, number> = {},
  scanFailures: Record<string, DataSourceScanFailure> = {}
): number | null {
  if (!enabled) return null;
  let earliestDeadline: number | null = null;
  for (const { sourceId } of IMPORTED_HISTORY_SOURCE_DESCRIPTORS) {
    const cfg = getSourceConfig(cfgMap, sourceId);
    if (!cfg.enabled) continue;
    const interval = FREQUENCY_INTERVAL_MS[effectiveFrequency(cfg, global)];
    if (interval == null) continue;

    const presence = previousPresence[sourceId];
    const probeDeadline = Math.max(
      probeRetryAt[sourceId] ?? 0,
      presence == null
        ? now
        : presence.checkedAt + SOURCE_PRESENCE_PROBE_INTERVAL_MS
    );
    const effectiveInterval = focused
      ? interval
      : Math.max(interval, UNFOCUSED_SCAN_INTERVAL_MS);
    const scanDeadline = nextSourceScanDeadline(
      cfg,
      scanFailures[sourceId],
      effectiveInterval,
      now
    );
    const deadline =
      presence?.historyFound === false
        ? probeDeadline
        : Math.min(scanDeadline, probeDeadline);
    earliestDeadline =
      earliestDeadline == null
        ? deadline
        : Math.min(earliestDeadline, deadline);
  }
  return earliestDeadline == null ? null : Math.max(0, earliestDeadline - now);
}

async function performDataSourceAutoScan(force: boolean): Promise<void> {
  const store = getInstrumentedStore();
  // Master switch: external sessions fully off — no scans, including startup.
  if (!store.get(externalSessionsEnabledAtom)) return;
  const cfgMap = store.get(dataSourceConfigAtom);
  const previousPresence = store.get(dataSourcePresenceAtom);
  const global = store.get(dataSourceGlobalFrequencyAtom);
  const scanFailures = store.get(dataSourceScanFailureAtom);
  const now = Date.now();

  const focused =
    (typeof document === "undefined" ||
      document.visibilityState !== "hidden") &&
    isWindowFocused();
  const candidates = IMPORTED_HISTORY_SOURCE_DESCRIPTORS.flatMap(
    ({ sourceId }) => {
      const cfg = getSourceConfig(cfgMap, sourceId);
      if (!cfg.enabled) return [];
      const interval = FREQUENCY_INTERVAL_MS[effectiveFrequency(cfg, global)];
      if (interval == null) return [];
      const effectiveInterval = focused
        ? interval
        : Math.max(interval, UNFOCUSED_SCAN_INTERVAL_MS);
      const due =
        force ||
        now >=
          nextSourceScanDeadline(
            cfg,
            scanFailures[sourceId],
            effectiveInterval,
            now
          );
      return [{ sourceId, scanDue: due }];
    }
  );
  if (candidates.length === 0) return;

  // Presence is checked independently from the full-import cadence. Confirmed
  // absent stores are held to a 30-minute probe; present stores are re-probed
  // on that same cadence so an uninstall/removal eventually stops full scans.
  const probeRetryAt = store.get(dataSourceProbeRetryAtAtom);
  const probeSourceIds = candidates.flatMap(({ sourceId }) => {
    if (!force && now < (probeRetryAt[sourceId] ?? 0)) return [];
    const presence = previousPresence[sourceId];
    const probeDue =
      force ||
      presence == null ||
      now - presence.checkedAt >= SOURCE_PRESENCE_PROBE_INTERVAL_MS;
    return probeDue ? [sourceId] : [];
  });
  const probeResults = await mapSettledWithConcurrency(
    probeSourceIds,
    2,
    async (sourceId) => ({
      sourceId,
      probe: await externalCliSourceProbe(sourceId),
    })
  );
  const successfulProbes = new Map<string, boolean>();
  const nextRetryAt: Record<string, number> = {};
  // Retain only enabled, automatic sources; the registry is descriptor-bounded.
  for (const { sourceId } of candidates) {
    if (probeRetryAt[sourceId]) nextRetryAt[sourceId] = probeRetryAt[sourceId];
  }
  for (const [index, result] of probeResults.entries()) {
    const sourceId = probeSourceIds[index]!;
    if (result.status === "fulfilled" && result.value.probe) {
      delete nextRetryAt[sourceId];
    } else {
      nextRetryAt[sourceId] = Date.now() + FAILED_SCAN_RETRY_MS;
    }
    if (result.status === "fulfilled" && result.value.probe) {
      successfulProbes.set(
        result.value.sourceId,
        result.value.probe.historyFound
      );
    }
  }
  store.set(dataSourceProbeRetryAtAtom, nextRetryAt);
  if (successfulProbes.size > 0) {
    store.set(dataSourcePresenceAtom, (previous) => {
      const next = { ...previous };
      for (const [sourceId, historyFound] of successfulProbes) {
        next[sourceId] = { historyFound, checkedAt: now };
      }
      return next;
    });
  }

  const currentPresence = store.get(dataSourcePresenceAtom);
  const dueSourceIds = candidates.flatMap(({ sourceId, scanDue }) => {
    const before = previousPresence[sourceId];
    const presence = currentPresence[sourceId];
    const newlyAvailable =
      before?.historyFound === false && presence?.historyFound === true;
    // Unknown presence is deliberately allowed through: a failed detector
    // must degrade to the previous full-scan behavior, not hide user history.
    const canScan = presence?.historyFound !== false;
    return canScan && (scanDue || newlyAvailable) ? [sourceId] : [];
  });

  // A successful negative probe is still a completed scheduler check and is
  // surfaced as "Last scan" in the Runtime pane, even though no importer ran.
  const absentProbeIds = [...successfulProbes].flatMap(
    ([sourceId, historyFound]) => (historyFound ? [] : [sourceId])
  );
  if (absentProbeIds.length > 0) {
    store.set(dataSourceConfigAtom, (previous) => {
      const next = { ...previous };
      for (const sourceId of absentProbeIds) {
        next[sourceId] = {
          ...getSourceConfig(previous, sourceId),
          lastScannedAt: now,
        };
      }
      return next;
    });
  }

  if (dueSourceIds.length === 0) return;
  const scanResult = await externalHistoryRescanSources(dueSourceIds);
  // One broken store must not hide the sources that did scan. Record the
  // failures first so their backoff holds even if the roster reload throws.
  const { succeeded, failed } = splitScanSourcesByOutcome(
    dueSourceIds,
    scanResult
  );
  for (const { sourceId, error } of failed) {
    // Warn once per distinct error, not on every backoff retry.
    if (scanFailures[sourceId]?.error !== error) {
      logger.warn(`Rescan failed for external source ${sourceId}:`, error);
    }
  }
  store.set(dataSourceScanFailureAtom, (previous) =>
    reduceDataSourceScanFailures(previous, succeeded, failed, Date.now())
  );
  // `changedSources` only covers writes made by THIS rescan. Other surfaces
  // (kanban, usage, an open transcript's pager) sync the same backend cache
  // between ticks — e.g. a continuation demotion applied during a foreign
  // sync — so also reload when a source's cache signature drifted from the
  // one captured at the roster's last rescan-driven reload. Without this the
  // sidebar can keep showing rows the backend demoted hours ago.
  const signatureBaseline = store.get(dataSourceRosterSignaturesAtom);
  const sourceSignatures = scanResult.sourceSignatures ?? {};
  const signatureDrifted = Object.entries(sourceSignatures).some(
    ([sourceId, signature]) => signatureBaseline[sourceId] !== signature
  );
  if (scanResult.changedSources.length > 0 || signatureDrifted) {
    await loadSessionRoster({ forceRefresh: true });
    store.set(dataSourceRosterSignaturesAtom, (previous) => ({
      ...previous,
      ...sourceSignatures,
    }));
  }

  if (succeeded.length === 0) return;
  const scannedAt = Date.now();
  store.set(dataSourceConfigAtom, (prev) => {
    const next = { ...prev };
    for (const sourceId of succeeded) {
      next[sourceId] = {
        ...getSourceConfig(prev, sourceId),
        lastScannedAt: scannedAt,
      };
    }
    return next;
  });
}

/** Run one deduplicated auto-scan pass. `force` is reserved for explicit refreshes. */
export async function runDataSourceAutoScan(force = false): Promise<void> {
  if (autoScanInFlight) return autoScanInFlight;

  const pass = performDataSourceAutoScan(force).catch((error: unknown) => {
    // The scheduler retries a rejected pass on its own timer; without this
    // line a pass that fails every time is invisible.
    logger.warn("External source auto-scan pass failed:", error);
    throw error;
  });
  autoScanInFlight = pass;
  try {
    await pass;
  } finally {
    if (autoScanInFlight === pass) autoScanInFlight = null;
  }
}

interface DataSourceAutoScanVisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

interface DataSourceAutoScanScheduler {
  trigger(force?: boolean): void;
  schedule(): void;
  stop(): void;
}

/**
 * Own the scheduler's one exact-deadline timeout. Hidden documents clear the
 * timer unless an explicit background consumer requires fresh external
 * history; that path uses the same unfocused cadence floor. Becoming visible
 * triggers one immediate due-check and re-arms the chain. Failed scans retry
 * after a bounded delay without creating a second timer or overlapping an
 * active scan.
 */
export function startDataSourceAutoScanScheduler(
  source: DataSourceAutoScanVisibilitySource,
  scan: (force?: boolean) => Promise<void>,
  nextDelay: () => number | null,
  failedScanRetryMs = FAILED_SCAN_RETRY_MS,
  shouldScanWhileHidden: () => boolean = () => false
): DataSourceAutoScanScheduler {
  let stopped = false;
  let running = false;
  let retryNotBefore = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timeoutId === undefined) return;
    clearTimeout(timeoutId);
    timeoutId = undefined;
  };
  const hiddenAndPaused = () =>
    source.visibilityState === "hidden" && !shouldScanWhileHidden();
  const schedule = () => {
    clearTimer();
    if (stopped || running || hiddenAndPaused()) return;
    const delay = nextDelay();
    if (delay == null) return;
    timeoutId = setTimeout(
      () => {
        timeoutId = undefined;
        trigger();
      },
      Math.max(1, delay, retryNotBefore - Date.now())
    );
  };
  const trigger = (force = false) => {
    clearTimer();
    if (stopped || running || hiddenAndPaused()) return;
    running = true;
    void scan(force)
      .then(
        () => {
          retryNotBefore = 0;
        },
        () => {
          retryNotBefore = Date.now() + failedScanRetryMs;
        }
      )
      .finally(() => {
        running = false;
        schedule();
      });
  };
  const onVisibilityChange = () => {
    clearTimer();
    if (source.visibilityState === "hidden") schedule();
    else trigger();
  };

  source.addEventListener("visibilitychange", onVisibilityChange);
  // Respect persisted per-source cadences on relaunch. Explicit refreshes can
  // still request a forced pass through trigger(true).
  trigger();
  return {
    trigger,
    schedule,
    stop: () => {
      stopped = true;
      clearTimer();
      source.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}

export function useDataSourceAutoScan(): void {
  useEffect(() => {
    // Secondary windows must not run a duplicate rescan cadence; the main
    // window's scheduler already keeps the shared backend cache fresh.
    if (!isMainAppWindow()) return;
    const store = getInstrumentedStore();
    const scheduler = startDataSourceAutoScanScheduler(
      document,
      runDataSourceAutoScan,
      () =>
        nextDataSourceAutoScanDelay(
          Date.now(),
          document.visibilityState !== "hidden" && isWindowFocused(),
          store.get(externalSessionsEnabledAtom),
          store.get(dataSourceConfigAtom),
          store.get(dataSourcePresenceAtom),
          store.get(dataSourceGlobalFrequencyAtom),
          store.get(dataSourceProbeRetryAtAtom),
          store.get(dataSourceScanFailureAtom)
        ),
      FAILED_SCAN_RETRY_MS,
      () => store.get(externalHistoryBackgroundScanEnabledAtom)
    );
    // A visible but unfocused window retains the low-frequency background
    // safety floor. Regaining focus immediately checks foreground cadences.
    const unsubscribeFocus = onWindowFocusRegained(() => {
      scheduler.trigger();
    });
    const unsubscribers = [
      store.sub(dataSourceConfigAtom, scheduler.schedule),
      store.sub(dataSourcePresenceAtom, scheduler.schedule),
      store.sub(dataSourceProbeRetryAtAtom, scheduler.schedule),
      store.sub(dataSourceScanFailureAtom, scheduler.schedule),
      store.sub(dataSourceGlobalFrequencyAtom, scheduler.schedule),
      store.sub(externalSessionsEnabledAtom, scheduler.schedule),
      store.sub(externalHistoryBackgroundScanEnabledAtom, scheduler.schedule),
    ];
    return () => {
      unsubscribeFocus();
      scheduler.stop();
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);
}
