import type { ConnectionStatus } from "../types";

/** One owner, one opening flight, and an explicit fence for late completions. */
export class ConnectionLifecycle<T> {
  private generation = 0;
  private resource: T | null = null;
  private opening: Promise<void> | null = null;
  private closing: Promise<void> = Promise.resolve();
  status: ConnectionStatus = { state: "disconnected" };

  constructor(private readonly release: (resource: T) => Promise<void>) {}

  get current(): T | null {
    return this.resource;
  }

  connect(open: () => Promise<T>): Promise<void> {
    if (this.resource !== null) return Promise.resolve();
    if (this.opening) return this.opening;
    const generation = this.generation;
    this.status = { state: "connecting" };
    const flight = (async () => {
      await this.closing.catch(() => {});
      if (generation !== this.generation)
        throw new Error("Database connection cancelled");
      let resource: T;
      try {
        resource = await open();
      } catch (error) {
        if (generation === this.generation) {
          this.status = {
            state: "error",
            error: error instanceof Error ? error.message : String(error),
          };
        }
        throw error;
      }
      if (generation !== this.generation) {
        await this.release(resource);
        throw new Error("Database connection cancelled");
      }
      this.resource = resource;
      this.status = { state: "connected", connectedAt: Date.now() };
    })();
    this.opening = flight;
    void flight
      .finally(() => {
        if (this.opening === flight) this.opening = null;
      })
      .catch(() => {});
    return flight;
  }

  disconnect(): Promise<void> {
    this.generation++;
    const opening = this.opening;
    this.opening = null;
    const resource = this.resource;
    this.resource = null;
    this.status = { state: "disconnected" };
    // Waiting for an opening flight ensures its late resource is released before
    // a reconnect is allowed to publish a new one.
    this.closing = Promise.allSettled([
      this.closing,
      opening ?? Promise.resolve(),
      resource === null ? Promise.resolve() : this.release(resource),
    ]).then((results) => {
      const release = results[2];
      if (release.status === "rejected") throw release.reason;
    });
    return this.closing;
  }
}

export function requireConnectionLease(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("Database backend returned an invalid connection lease");
  return value;
}
