import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { org2CloudEndpointOverrideAtom } from "./org2CloudEndpointAtom";
import {
  endpointForOrg,
  subscribeOrgEndpointDirectory,
} from "./org2CloudOrgEndpointRouter";
import type { CloudStore } from "./org2CloudSyncLifecycle";
import type { CloudSyncRequestOptions } from "./org2CloudSyncRequest.types";

/** One operation owns its store, identity, endpoint, and lifecycle generation. */
export interface CloudSessionOperation extends CloudSyncRequestOptions {
  readonly store: CloudStore;
  readonly request: CloudSyncRequestOptions;
  wait<T>(work: () => Promise<T>): Promise<T>;
  dispose(): void;
}

export function createCloudSessionOperation(
  store: CloudStore,
  auth: Org2CloudAuthState,
  orgId: string,
  isCurrentGeneration: () => boolean,
  controller: AbortController
): CloudSessionOperation {
  const identity = org2CloudAuthIdentityKey(auth);
  const endpoint = Object.freeze({ ...endpointForOrg(orgId) });
  let initialOverride = store.get(org2CloudEndpointOverrideAtom);
  let endpointSubscriptionReady = false;
  const assertCurrent = () => {
    const current = store.get(org2CloudAuthAtom);
    const routed = endpointForOrg(orgId);
    if (
      controller.signal.aborted ||
      !isCurrentGeneration() ||
      !current ||
      org2CloudAuthIdentityKey(current) !== identity ||
      routed.supabaseUrl !== endpoint.supabaseUrl ||
      routed.anonKey !== endpoint.anonKey
    ) {
      controller.abort();
      throw new DOMException("Cloud sync operation superseded", "AbortError");
    }
  };
  assertCurrent();
  // Invalidate at the producing boundary, including a shard cutover that
  // retains the same auth. Do not wait for React or a hung fetch to settle.
  const onContextChanged = () => {
    try {
      assertCurrent();
    } catch {
      // Cancellation is observed by the operation/fetch, not the atom writer.
    }
  };
  const unsubscribeAuth = store.sub(org2CloudAuthAtom, onContextChanged);
  const unsubscribeEndpoint = store.sub(org2CloudEndpointOverrideAtom, () => {
    // First subscription hydrates atomWithStorage from disk. Establish the
    // baseline after mounting so hydration is not mistaken for a cutover.
    if (!endpointSubscriptionReady) return;
    // atomWithStorage can notify before its localStorage write, so compare
    // the authoritative atom rather than rereading the persisted router.
    const current = store.get(org2CloudEndpointOverrideAtom);
    if (
      current?.supabaseUrl !== initialOverride?.supabaseUrl ||
      current?.anonKey !== initialOverride?.anonKey
    )
      controller.abort();
    else onContextChanged();
  });
  initialOverride = store.get(org2CloudEndpointOverrideAtom);
  endpointSubscriptionReady = true;
  const unsubscribeDirectory = subscribeOrgEndpointDirectory(onContextChanged);
  return {
    store,
    request: Object.freeze({
      endpoint,
      signal: controller.signal,
      assertCurrent,
    }),
    endpoint,
    signal: controller.signal,
    assertCurrent,
    async wait<T>(work: () => Promise<T>): Promise<T> {
      assertCurrent();
      let onAbort: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_resolve, reject) => {
          onAbort = () =>
            reject(new DOMException("Cloud sync stopped", "AbortError"));
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
        const result = await Promise.race([work(), cancelled]);
        assertCurrent();
        return result;
      } catch (error) {
        assertCurrent();
        throw error;
      } finally {
        if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      }
    },
    dispose() {
      unsubscribeAuth();
      unsubscribeEndpoint();
      unsubscribeDirectory();
    },
  };
}
