import type { CloudEndpoint } from "./config";

/** Fixed destination and cancellation; no store or lifecycle owner dependency. */
export interface CloudSyncRequestOptions {
  readonly endpoint: CloudEndpoint;
  readonly signal: AbortSignal;
  assertCurrent(): void;
}
