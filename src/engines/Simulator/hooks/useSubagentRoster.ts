import { invoke } from "@tauri-apps/api/core";
import { useStore } from "jotai";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import { subagentJobMapAtom } from "@src/store/session/subagentJobAtom";
import { createStableWeakLruCache } from "@src/util/core/state/stableWeakLruCache";

import { createSubagentRosterResource } from "./subagentRosterResource";
import type { ChildSessionRecord } from "./subagentSessionProjection";

type Store = ReturnType<typeof useStore>;
type Resource = ReturnType<typeof createSubagentRosterResource>;
const resources = new WeakMap<
  Store,
  ReturnType<typeof createStableWeakLruCache<Resource>>
>();

function getResource(store: Store, parentId: string | null) {
  let cache = resources.get(store);
  if (!cache) {
    cache = createStableWeakLruCache<Resource>(12);
    resources.set(store, cache);
  }
  const key = parentId ?? "";
  const existing = cache.get(key);
  if (existing) return existing;
  const resource = createSubagentRosterResource(
    () =>
      parentId
        ? invoke<ChildSessionRecord[]>("es_get_child_sessions", {
            parentSessionId: parentId,
          })
        : Promise.resolve([]),
    (changed) => {
      if (!parentId) return () => {};
      let jobs = store.get(subagentJobMapAtom).get(parentId);
      const unsubs = [
        eventStoreProxy.subscribe((_snapshot, id) =>
          changed(id === parentId ? "" : id)
        ),
        store.sub(sessionByIdAtom(parentId), () => changed("")),
        store.sub(subagentJobMapAtom, () => {
          const next = store.get(subagentJobMapAtom).get(parentId);
          if (jobs !== next) {
            jobs = next;
            changed("");
          }
        }),
      ];
      return () => unsubs.forEach((unsubscribe) => unsubscribe());
    },
    document
  );
  cache.set(key, resource);
  return resource;
}

export function useSubagentRoster(parentId: string | null, revision?: number) {
  const store = useStore();
  const resource = useMemo(
    () => getResource(store, parentId),
    [store, parentId]
  );
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot
  );
  useEffect(() => {
    if (revision !== undefined) resource.setRevision(revision);
  }, [resource, revision]);
  return { ...state, retry: resource.refresh };
}
