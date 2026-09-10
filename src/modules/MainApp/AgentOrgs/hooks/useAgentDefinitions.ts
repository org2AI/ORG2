/**
 * useAgentDefinitions — Single source of truth for agent definitions.
 *
 * Fetches ALL agent definitions (builtins + custom) from the Rust backend
 * via `agent_definitions_list_all` exactly once per app lifetime, stores
 * them in `allAgentDefsAtom`, and projects the list into:
 * - `builtInAgents`: user-visible built-ins (internal subagents filtered out)
 * - `agents`: user-created custom agents (CRUD-able)
 *
 * Multiple instances may mount in parallel (AgentOrgsPage, ChatPanel,
 * WorkItem detail, etc). Because the underlying state lives on Jotai
 * atoms, every CRUD mutation propagates to every consumer.
 *
 * Staleness: the backend emits `orgii-agent-defs-changed` on EVERY store
 * mutation (RPC commands, skills_toggle, the manage_agent_def LLM tool).
 * The first mounted instance subscribes and re-fetches, so writes from
 * outside this hook (e.g. the agent editing its own definition) propagate
 * without manual refresh calls.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import { useMounted } from "@src/hooks/lifecycle/useMounted";
import { createLogger } from "@src/hooks/logger";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";

import {
  agentDefsLoadErrorAtom,
  agentDefsLoadedAtom,
  allAgentDefsAtom,
  builtInAgentsAtom,
  customAgentsAtom,
} from "../store/builtInAgentsAtom";
import type { AgentDefinition } from "../types";

const log = createLogger("AgentDefinitions");

// Module-level guard so concurrent first-mounts coalesce into a single
// in-flight fetch instead of racing N requests against the backend.
let inflightFetch: Promise<AgentDefinition[]> | null = null;

// Module-level guard: only one Tauri listener for the defs-changed event.
let changeListenerInstalled = false;

async function fetchAllDefs(forceFresh = false): Promise<AgentDefinition[]> {
  if (!forceFresh && inflightFetch) return inflightFetch;
  const request = rpc.agentDef.listAll();
  if (forceFresh) return request;
  inflightFetch = request.finally(() => {
    inflightFetch = null;
  });
  return inflightFetch;
}

export function useAgentDefinitions() {
  const builtInAgents = useAtomValue(builtInAgentsAtom);
  const agents = useAtomValue(customAgentsAtom);
  const setAllDefs = useSetAtom(allAgentDefsAtom);
  const setAgentDefsLoaded = useSetAtom(agentDefsLoadedAtom);
  const loaded = useAtomValue(agentDefsLoadedAtom);
  const loadError = useAtomValue(agentDefsLoadErrorAtom);
  const setLoadError = useSetAtom(agentDefsLoadErrorAtom);
  const [loading, setLoading] = useState(!loaded);
  const mountedRef = useMounted();
  const hasTriggeredFetchRef = useRef(false);

  const applyResult = useCallback(
    (result: AgentDefinition[]) => {
      setAllDefs(result);
      setAgentDefsLoaded(true);
      setLoadError(null);
    },
    [setAllDefs, setAgentDefsLoaded, setLoadError]
  );

  const refresh = useCallback(
    async (options?: { forceFresh?: boolean }) => {
      setLoading(true);
      try {
        const result = await fetchAllDefs(options?.forceFresh === true);
        if (mountedRef.current) {
          applyResult(result);
        }
      } catch (error) {
        log.error("[AgentDefinitions] Failed to fetch:", error);
        if (mountedRef.current) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [applyResult, setLoadError, mountedRef]
  );

  useEffect(() => {
    if (loaded || hasTriggeredFetchRef.current) {
      setLoading(false);
      return;
    }
    hasTriggeredFetchRef.current = true;
    void refresh();
  }, [loaded, refresh]);

  // Backend-driven invalidation: any store mutation (including LLM-tool
  // writes that never touch this hook) re-syncs the atoms. The first mounted
  // instance claims the single listener slot; it is released on unmount.
  const [ownsChangeListener, setOwnsChangeListener] = useState(false);
  useEffect(() => {
    if (changeListenerInstalled) return;
    changeListenerInstalled = true;
    setOwnsChangeListener(true);
    return () => {
      changeListenerInstalled = false;
      setOwnsChangeListener(false);
    };
  }, []);

  useTauriListen(
    "orgii-agent-defs-changed",
    () => {
      void fetchAllDefs(true)
        .then((result) => applyResult(result))
        .catch((error) => {
          log.error(
            "[AgentDefinitions] Failed to refresh after defs-changed:",
            error
          );
        });
    },
    { enabled: ownsChangeListener }
  );

  const addAgent = useCallback(
    async (agent: AgentDefinition) => {
      setLoading(true);
      try {
        await rpc.agentDef.add({ agentJson: JSON.stringify(agent) });
        await refresh({ forceFresh: true });
      } catch (error) {
        log.error("[AgentDefinitions] Failed to add:", error);
        throw error;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [refresh, mountedRef]
  );

  const removeAgent = useCallback(
    async (agentId: string) => {
      setLoading(true);
      try {
        const removed = await rpc.agentDef.remove({ agentId });
        if (!removed) {
          throw new Error(`Agent '${agentId}' was not found`);
        }
        setAllDefs((current) =>
          current.filter((agent) => agent.id !== agentId)
        );
        setAgentDefsLoaded(true);
        setLoadError(null);
      } catch (error) {
        log.error("[AgentDefinitions] Failed to remove:", error);
        throw error;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [mountedRef, setAgentDefsLoaded, setAllDefs, setLoadError]
  );

  return {
    /** User-visible built-in agents (from Rust, internal ones filtered out). */
    builtInAgents,
    /** User-created custom agents (CRUD-able). */
    agents,
    loading,
    loadError,
    refresh,
    addAgent,
    removeAgent,
  };
}
