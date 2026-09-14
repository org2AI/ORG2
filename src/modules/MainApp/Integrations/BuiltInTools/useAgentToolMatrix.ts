import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { AgentToolStateRow as ResolvedTool } from "@src/api/tauri/rpc/schemas/agentDef";
import { useEnsureAgentDefs } from "@src/modules/MainApp/AgentOrgs/hooks/useEnsureAgentDefs";
import {
  allAgentDefsAtom,
  builtInAgentsAtom,
  customAgentsAtom,
} from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";

import type { AgentDefinition } from "../../AgentOrgs/types";

export interface AgentToolStateRow {
  agentId: string;
  label: string;
  builtIn: boolean;
  pinned: boolean;
  enabled: boolean;
  disabled: boolean;
}
interface Resolution {
  key: symbol;
  rows: Map<string, ResolvedTool>;
  error: string | null;
}
interface InflightResolution {
  key: symbol;
  agentId: string;
  promise: Promise<ResolvedTool[]>;
}

function definitionGraphContent(definitions: AgentDefinition[]): string {
  return JSON.stringify(
    [...definitions].sort((left, right) => left.id.localeCompare(right.id)),
    (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([left], [right]) =>
              left.localeCompare(right)
            )
          )
        : value
  );
}

/** Display availability resolved by Rust; the matrix never reimplements capability rules. */
export function useAgentToolMatrix() {
  const defsLoaded = useEnsureAgentDefs();
  const builtInAgents = useAtomValue(builtInAgentsAtom);
  const customAgents = useAtomValue(customAgentsAtom);
  const allDefinitions = useAtomValue(allAgentDefsAtom);
  const setAllDefs = useSetAtom(allAgentDefsAtom);
  // Rust resolves inheritance against the complete definition graph, including
  // internal agents absent from the matrix. Retain its content once; cache and
  // in-flight entries share this token instead of copying the graph per agent.
  const graphContent = useMemo(
    () => definitionGraphContent(allDefinitions),
    [allDefinitions]
  );
  const graphSnapshot = useMemo(
    () => ({ content: graphContent, version: Symbol("definition graph") }),
    [graphContent]
  );
  const records = useMemo(
    () =>
      [...builtInAgents, ...customAgents].map((definition) => ({
        definition,
        key: graphSnapshot.version,
      })),
    [builtInAgents, customAgents, graphSnapshot.version]
  );
  const [resolved, setResolved] = useState<Map<string, Resolution>>(new Map());
  const cache = useRef(new Map<string, Resolution>());
  const inflight = useRef(new Set<InflightResolution>());
  const pendingWrites = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());
  const [writeError, setWriteError] = useState<string | null>(null);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!defsLoaded) return;
    let cancelled = false;
    const ids = new Set(records.map(({ definition }) => definition.id));
    let evicted = false;
    for (const id of cache.current.keys()) {
      if (!ids.has(id)) {
        cache.current.delete(id);
        evicted = true;
      }
    }
    if (evicted)
      setResolved(
        (previous) => new Map([...previous].filter(([id]) => ids.has(id)))
      );
    const queue = records.filter(
      ({ definition, key }) => cache.current.get(definition.id)?.key !== key
    );
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < queue.length) {
        const { definition, key } = queue[cursor++];
        let request = [...inflight.current].find(
          (active) => active.key === key && active.agentId === definition.id
        )?.promise;
        if (!request) {
          // Share the four slots across superseded generations as well.
          while (!cancelled && inflight.current.size >= 4) {
            await Promise.race(
              [...inflight.current].map((active) =>
                active.promise.catch(() => [])
              )
            );
          }
          if (cancelled) return;
          request = rpc.agentDef.toolStates({ agentId: definition.id });
          const active = { key, agentId: definition.id, promise: request };
          inflight.current.add(active);
          void request
            .finally(() => inflight.current.delete(active))
            .catch(() => {});
        }
        let result: Resolution;
        try {
          result = {
            key,
            rows: new Map((await request).map((row) => [row.name, row])),
            error: null,
          };
        } catch (error) {
          result = { key, rows: new Map(), error: String(error) };
        }
        if (cancelled) return;
        cache.current.set(definition.id, result);
        setResolved(new Map(cache.current));
      }
    };
    void Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, worker)
    ).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [defsLoaded, records, refreshEpoch]);

  const rowsByTool = useCallback(
    (toolName: string): AgentToolStateRow[] =>
      records.map(({ definition, key }) => {
        const result = resolved.get(definition.id);
        const row = result?.key === key ? result.rows.get(toolName) : undefined;
        return {
          agentId: definition.id,
          label: definition.name || definition.id,
          builtIn: Boolean(definition.builtIn),
          pinned: row?.systemPinned ?? false,
          enabled: row?.enabled ?? false,
          disabled:
            !row ||
            row.capabilityBlocked ||
            row.systemPinned ||
            pending.has(definition.id),
        };
      }),
    [records, resolved, pending]
  );

  const toggle = useCallback(
    async (agentId: string, toolName: string, next: boolean) => {
      const row = rowsByTool(toolName).find(
        (entry) => entry.agentId === agentId
      );
      if (!row || row.disabled || pendingWrites.current.has(agentId)) return;
      pendingWrites.current.add(agentId);
      setPending(new Set(pendingWrites.current));
      setWriteError(null);
      try {
        const definition = (await rpc.agentDef.get({
          agentId,
        })) as unknown as AgentDefinition;
        const allowed = new Set(definition.tools?.userAllowedTools ?? []);
        const excluded = new Set(definition.tools?.excludedTools ?? []);
        if (next) {
          allowed.add(toolName);
          excluded.delete(toolName);
        } else {
          allowed.delete(toolName);
          excluded.add(toolName);
        }
        const saved = await rpc.agentDef.updatePatch({
          agentId,
          patch: {
            tools: {
              userAllowedTools: [...allowed],
              excludedTools: [...excluded],
            },
          },
        });
        if (mounted.current) {
          cache.current.delete(agentId);
          setAllDefs((current) =>
            current.map((entry) =>
              entry.id === agentId
                ? (saved as unknown as AgentDefinition)
                : entry
            )
          );
        }
      } catch (error) {
        if (mounted.current) setWriteError(String(error));
      } finally {
        pendingWrites.current.delete(agentId);
        if (mounted.current) setPending(new Set(pendingWrites.current));
      }
    },
    [rowsByTool, setAllDefs]
  );

  const refresh = useCallback(() => {
    cache.current.clear();
    setResolved(new Map());
    setWriteError(null);
    setRefreshEpoch((current) => current + 1);
  }, []);
  return {
    loaded:
      defsLoaded &&
      records.every(
        ({ definition, key }) => resolved.get(definition.id)?.key === key
      ),
    error:
      writeError ??
      records
        .map(({ definition, key }) =>
          resolved.get(definition.id)?.key === key
            ? resolved.get(definition.id)?.error
            : null
        )
        .find(Boolean) ??
      null,
    refresh,
    rowsByTool,
    toggle,
    agentCount: records.length,
  };
}
export type UseAgentToolMatrixReturn = ReturnType<typeof useAgentToolMatrix>;
