import { scheduleCoalescedStorageWrite } from "@src/util/core/storage/coalescedStorageWrite";

const WORK_STATION_PREFIX = "work_station_";

const STORAGE_KEYS = [
  "layout_mode",
  "primary_sidebar_collapsed",
  "primary_sidebar_width",
  "browser_devtools_position",
  "devtools_collapsed",
  "bottom_collapsed",
] as const;

export type WorkStationStorageKey = (typeof STORAGE_KEYS)[number];

function batchReadStorage(): Map<WorkStationStorageKey, string | null> {
  const result = new Map<WorkStationStorageKey, string | null>();

  try {
    for (const key of STORAGE_KEYS) {
      const value = localStorage.getItem(`${WORK_STATION_PREFIX}${key}`);
      result.set(key, value);
    }
  } catch {
    // ignore localStorage errors
  }

  return result;
}

/**
 * Authoritative in-process value for every key.
 *
 * Seeded from one batched read at module load to avoid N synchronous reads
 * during atom init, then kept current by `setStoredValue`. Reads must never
 * go back to `localStorage`: the disk write is coalesced, so between a write
 * and its flush the disk is deliberately behind this map.
 */
const storedValues = batchReadStorage();

export function getStoredValue(key: WorkStationStorageKey): string | null {
  return storedValues.get(key) ?? null;
}

/**
 * Record `value` for `key` and queue the disk write.
 *
 * The write is coalesced (see `coalescedStorageWrite`) because these keys are
 * panel geometry and collapsed flags: a resize drag calls this once per
 * animation frame, and a synchronous `setItem` per frame is a main-thread
 * cost for a value only the resting state of which matters. The in-memory map
 * updates synchronously, so `getStoredValue` never observes the lag.
 */
export function setStoredValue(
  key: WorkStationStorageKey,
  value: string
): void {
  storedValues.set(key, value);
  const storageKey = `${WORK_STATION_PREFIX}${key}`;
  scheduleCoalescedStorageWrite(storageKey, () => {
    localStorage.setItem(storageKey, value);
  });
}
