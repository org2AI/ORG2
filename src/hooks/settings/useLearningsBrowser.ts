/**
 * useLearningsBrowser
 *
 * Backs the Learnings Browser: paged/filtered list +
 * status/body edits + delete. Purely UI-facing thin wrappers over
 * the `rpc.learning.*` procedures — no cross-module business logic,
 * so the hook lives under `src/hooks/settings/` (single-module use).
 */
import { useCallback, useEffect, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type {
  LearningCategoryValue,
  LearningRecord,
  LearningSourceValue,
  LearningStatusValue,
  SettableLearningStatusValue,
} from "@src/api/tauri/rpc/schemas/learning";

export interface LearningsBrowserFilters {
  agentScope?: string;
  status?: LearningStatusValue;
  source?: LearningSourceValue;
  category?: LearningCategoryValue;
  search?: string;
}

export interface UseLearningsBrowserOptions {
  /** When set and no explicit `filters.agentScope` is active, browse these
   *  per-agent scopes and merge the rows client-side. */
  agentScopes?: string[];
}

export interface UseLearningsBrowserReturn {
  /** Full list after server-side filter; order follows `updated_at DESC`. */
  items: LearningRecord[];
  loading: boolean;
  error: string | null;
  filters: LearningsBrowserFilters;
  setFilters: (next: LearningsBrowserFilters) => void;
  refresh: () => Promise<void>;
  setStatus: (id: string, next: SettableLearningStatusValue) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useLearningsBrowser(
  options: UseLearningsBrowserOptions = {}
): UseLearningsBrowserReturn {
  const [items, setItems] = useState<LearningRecord[]>([]);
  const [filters, setFiltersState] = useState<LearningsBrowserFilters>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchAll = useCallback(
    async (current: LearningsBrowserFilters) => {
      setLoading(true);
      setError(null);
      try {
        const scopes = current.agentScope
          ? [current.agentScope]
          : options.agentScopes;
        if (scopes && scopes.length > 0) {
          const lists = await Promise.all(
            scopes.map((agentScope) =>
              rpc.learning.browseList({
                agentScope,
                status: current.status,
                source: current.source,
                category: current.category,
                search: current.search,
              })
            )
          );
          const byId = new Map<string, LearningRecord>();
          for (const list of lists) {
            for (const row of list) byId.set(row.id, row);
          }
          const merged = [...byId.values()].sort((rowA, rowB) =>
            rowB.updated_at.localeCompare(rowA.updated_at)
          );
          setItems(merged);
          return;
        }

        const list = await rpc.learning.browseList({
          agentScope: current.agentScope,
          status: current.status,
          source: current.source,
          category: current.category,
          search: current.search,
        });
        setItems(list);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [options.agentScopes]
  );

  useEffect(() => {
    void fetchAll(filters);
  }, [filters, fetchAll]);

  const refresh = useCallback(async () => {
    await fetchAll(filters);
  }, [fetchAll, filters]);

  const setFilters = useCallback((next: LearningsBrowserFilters) => {
    setFiltersState(next);
  }, []);

  const setStatus = useCallback(
    async (id: string, next: SettableLearningStatusValue) => {
      await rpc.learning.setStatus({ learningId: id, next });
      await fetchAll(filters);
    },
    [fetchAll, filters]
  );

  const remove = useCallback(
    async (id: string) => {
      await rpc.learning.remove({ learningId: id });
      await fetchAll(filters);
    },
    [fetchAll, filters]
  );

  return {
    items,
    loading,
    error,
    filters,
    setFilters,
    refresh,
    setStatus,
    remove,
  };
}
