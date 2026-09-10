import type { MobileRemoteRuntimePort } from "../platform/types";
import type { MobileConnectionConfig } from "./types";

/** Owns one retry timer and one recovery attempt per connection generation. */
export function createRemoteReconnectController(
  runtime: Pick<
    MobileRemoteRuntimePort,
    "setTimeout" | "clearTimeout" | "isHidden" | "random"
  >,
  isCurrent: (generation: number) => boolean,
  recover: (config: MobileConnectionConfig, generation: number) => Promise<void>
) {
  let timer: number | null = null;
  let attempts = 0;
  let inFlight: { generation: number; promise: Promise<void> } | null = null;
  const clear = () => {
    if (timer !== null) runtime.clearTimeout(timer);
    timer = null;
  };
  const run = (
    config: MobileConnectionConfig,
    generation: number
  ): Promise<void> => {
    if (!isCurrent(generation) || runtime.isHidden()) return Promise.resolve();
    if (inFlight?.generation === generation) return inFlight.promise;
    // Publish the flight before invoking recovery, including synchronous adapters.
    const promise = Promise.resolve().then(() => {
      if (
        inFlight?.promise !== promise ||
        !isCurrent(generation) ||
        runtime.isHidden()
      )
        return;
      return recover(config, generation);
    });
    inFlight = { generation, promise };
    const settled = () => {
      if (inFlight?.promise === promise) inFlight = null;
    };
    void promise.then(settled, settled);
    return promise;
  };
  return {
    clear,
    invalidate() {
      clear();
      inFlight = null;
    },
    reset() {
      clear();
      attempts = 0;
    },
    run,
    schedule(config: MobileConnectionConfig, generation: number) {
      clear();
      if (!isCurrent(generation) || runtime.isHidden()) return;
      attempts += 1;
      const seconds = Math.min(30, 2 ** Math.min(Math.max(attempts - 1, 0), 5));
      timer = runtime.setTimeout(
        () => {
          timer = null;
          void run(config, generation).catch(() => undefined);
        },
        seconds * 1000 + Math.floor(runtime.random() * 500)
      );
    },
  };
}
