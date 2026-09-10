/** One in-flight native update plus one latest snapshot; no idle timer. */
export function createTraySync<T>(
  write: (snapshot: T) => Promise<void>,
  onError: (error: unknown) => void
) {
  let stopped = false;
  let running = false;
  let pending: T | undefined;
  let lastWritten: string | undefined;

  async function flush() {
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped && pending !== undefined) {
        const snapshot = pending;
        pending = undefined;
        const key = JSON.stringify(snapshot);
        if (key === lastWritten) continue;
        try {
          await write(snapshot);
          lastWritten = key;
        } catch (error) {
          onError(error);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    update(snapshot: T) {
      if (stopped) return;
      pending = snapshot;
      void flush();
    },
    stop() {
      stopped = true;
      pending = undefined;
    },
  };
}
