/**
 * EventStore — barrel export.
 *
 * Re-exports the Rust-backed proxy and its types.
 */

// Rust-backed EventStore proxy
export { eventStoreProxy } from "./EventStoreProxy";
export type {
  DerivedSnapshot,
  StreamingSnapshot,
  EventStoreProxy,
} from "./EventStoreProxy";

export { eventStoreProxy as eventStore } from "./EventStoreProxy";
