/**
 * Trailing-coalesced localStorage writes.
 *
 * `localStorage.setItem` is synchronous and hits disk. A value driven by a
 * pointer drag is rewritten once per animation frame — panel widths and
 * heights are the standing example — so a two-second resize costs ~120
 * synchronous disk writes on the main thread for one value the user only
 * cares about at rest.
 *
 * Writes scheduled here collapse per key: the newest write for a key replaces
 * any pending one, and the whole batch lands once the caller stops writing.
 * Every pending write is flushed when the document goes away, so the last
 * value still reaches disk on quit, reload or window close.
 *
 * This is for values that are *re-derivable or cosmetic* if the final write is
 * lost to a crash — layout geometry, collapsed flags. Anything whose loss is
 * user-visible data must keep writing synchronously.
 */

/** Trailing debounce. Long enough to swallow a drag, short enough to survive a quick quit. */
const DEFAULT_DELAY_MS = 200;

const pendingWrites = new Map<string, () => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Runs every pending write now and clears the queue. */
export function flushCoalescedStorageWrites(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingWrites.size === 0) return;
  // Snapshot before running: a write that throws must not strand the rest,
  // and must not be retried on the next flush.
  const writes = [...pendingWrites.values()];
  pendingWrites.clear();
  for (const write of writes) {
    try {
      write();
    } catch {
      // A failed persist degrades to in-memory-only state. The caller's
      // snapshot is already updated, so swallowing here keeps a full disk or
      // a denied storage API from breaking an unrelated queued key.
    }
  }
}

/**
 * Queue `write` for `key`, replacing any write already queued for it.
 *
 * The caller is responsible for keeping its own in-memory value authoritative
 * — readers must never wait on the flush.
 */
export function scheduleCoalescedStorageWrite(
  key: string,
  write: () => void,
  delayMs: number = DEFAULT_DELAY_MS
): void {
  pendingWrites.set(key, write);
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushCoalescedStorageWrites();
  }, delayMs);
}

/**
 * Drop any write queued for `key` without running it.
 *
 * Needed by callers that follow a write with a removal: the queued write
 * closes over the old value, so leaving it queued would resurrect the key on
 * the next flush.
 */
export function cancelCoalescedStorageWrite(key: string): void {
  pendingWrites.delete(key);
}

/** Test-only: drop the queue without running it. */
export function _resetCoalescedStorageWritesForTests(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingWrites.clear();
}

// `pagehide` is the reliable teardown signal in WebKit; `visibilitychange`
// covers the case where the window is hidden but never unloaded. Both are
// cheap because the queue is almost always empty.
//
// `window` and `document` are probed separately: this module is imported by
// store code that also runs under the node test environment, where a partial
// global shim can provide one without the other.
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener("pagehide", flushCoalescedStorageWrites);
  window.addEventListener("beforeunload", flushCoalescedStorageWrites);
}
if (
  typeof document !== "undefined" &&
  typeof document.addEventListener === "function"
) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushCoalescedStorageWrites();
  });
}

/**
 * Minimal structural view of a jotai sync storage. Kept local so this module
 * stays free of a zod dependency; `ZodSyncStorage<T>` satisfies it.
 */
interface CoalescableSyncStorage<T> {
  getItem: (key: string, initialValue: T) => T;
  setItem: (key: string, value: T) => void;
  removeItem: (key: string) => void;
  subscribe?: (
    key: string,
    callback: (value: T) => void,
    initialValue: T
  ) => () => void;
}

/**
 * Wrap a sync storage so its writes coalesce, for atoms driven by a drag.
 *
 * `getItem` answers from the pending value while a write is in flight, so the
 * deferral is invisible to readers — including the cross-window `subscribe`
 * path, which is left untouched.
 */
export function withCoalescedWrites<T>(
  storage: CoalescableSyncStorage<T>,
  delayMs: number = DEFAULT_DELAY_MS
): CoalescableSyncStorage<T> {
  const pendingValues = new Map<string, T>();

  return {
    ...storage,
    getItem: (key: string, initialValue: T) =>
      pendingValues.has(key)
        ? (pendingValues.get(key) as T)
        : storage.getItem(key, initialValue),
    setItem: (key: string, value: T) => {
      pendingValues.set(key, value);
      scheduleCoalescedStorageWrite(
        key,
        () => {
          pendingValues.delete(key);
          storage.setItem(key, value);
        },
        delayMs
      );
    },
    removeItem: (key: string) => {
      // Removal is never drag-driven, so it runs now. Cancelling the queued
      // write is the load-bearing half: it closes over the old value, so a
      // later flush would otherwise write the key straight back.
      pendingValues.delete(key);
      cancelCoalescedStorageWrite(key);
      storage.removeItem(key);
    },
  };
}
