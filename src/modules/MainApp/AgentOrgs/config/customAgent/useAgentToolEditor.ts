import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { AgentToolStateRow } from "@src/api/tauri/rpc/schemas/agentDef";
import { createLogger } from "@src/hooks/logger";
import type {
  AgentDefinition,
  AgentToolSelection,
  CapabilitySet,
} from "@src/modules/MainApp/AgentOrgs/types";
import type { AgentKind } from "@src/modules/MainApp/Integrations/BuiltInTools/types";

const log = createLogger("useAgentToolEditor");
export type ToolEditorState = "system_pinned" | "enabled" | "disabled";
export interface AgentToolEditorState {
  loaded: boolean;
  error: string | null;
  retry: () => void;
  builtIn: boolean;
  agentKind: AgentKind;
  capabilities: CapabilitySet;
  systemRestrictToTools: string[] | null;
  userAllowedTools: Set<string>;
  excludedTools: Set<string>;
  resolvedToolState: (name: string) => AgentToolStateRow | undefined;
  toolState: (name: string) => ToolEditorState;
  setToolEnabled: (name: string, enabled: boolean) => void;
}
interface Snapshot {
  agentId: string;
  definition: AgentDefinition;
  rows: Map<string, AgentToolStateRow>;
  tools: AgentToolSelection;
  /** User intent only while waiting for the authoritative save response. */
  pending: Map<string, boolean>;
}

export function useAgentToolEditor(agentId: string): AgentToolEditorState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<{
    agentId: string;
    message: string;
  } | null>(null);
  const [loadEpoch, setLoadEpoch] = useState(0);
  const current = useRef<Snapshot | null>(null);
  const mounted = useRef(false);
  const scope = useRef(agentId);
  useEffect(() => {
    scope.current = agentId;
  }, [agentId]);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ snapshot: Snapshot; revision: number } | null>(
    null
  );
  const queuedWrites = useRef(
    new Map<string, { snapshot: Snapshot; revision: number }>()
  );
  const writing = useRef(false);

  const apply = useCallback((next: Snapshot) => {
    if (!mounted.current || scope.current !== next.agentId) return;
    current.current = next;
    setSnapshot(next);
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const request = pendingSave.current;
    pendingSave.current = null;
    if (!request) return;
    queuedWrites.current.set(request.snapshot.agentId, request);
    if (writing.current) return;
    writing.current = true;
    // One writer, with at most the latest unsent snapshot for each edited agent.
    void (async () => {
      while (queuedWrites.current.size > 0) {
        const entry = queuedWrites.current.entries().next().value;
        if (!entry) break;
        const [key, request] = entry;
        queuedWrites.current.delete(key);
        const id = request.snapshot.agentId;
        try {
          await rpc.agentDef.updatePatch({
            agentId: id,
            patch: {
              tools: {
                userAllowedTools: request.snapshot.tools.userAllowedTools ?? [],
                excludedTools: request.snapshot.tools.excludedTools ?? [],
              },
            },
          });
        } catch (error) {
          log.error("persistTools failed", error);
          if (mounted.current && scope.current === id)
            setFailure({ agentId: id, message: String(error) });
        }
        try {
          // Read back even on failure so optimistic state cannot pose as a saved fact.
          const [definition, rows] = await Promise.all([
            rpc.agentDef.get({ agentId: id }),
            rpc.agentDef.toolStates({ agentId: id }),
          ]);
          if (request.revision !== revision.current) continue;
          const typed = definition as unknown as AgentDefinition;
          apply({
            agentId: id,
            definition: typed,
            tools: typed.tools ?? {},
            rows: new Map(rows.map((row) => [row.name, row])),
            pending: new Map(),
          });
        } catch (error) {
          log.error("refresh tools failed", error);
          if (mounted.current && scope.current === id)
            setFailure({ agentId: id, message: String(error) });
          if (request.revision === revision.current) {
            apply({
              ...request.snapshot,
              tools: request.snapshot.definition.tools ?? {},
              pending: new Map(),
            });
          }
        }
      }
    })()
      .finally(() => {
        writing.current = false;
      })
      .catch((error) => log.error("Tool write queue failed", error));
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const requestRevision = ++revision.current;
    void Promise.all([
      rpc.agentDef.get({ agentId }),
      rpc.agentDef.toolStates({ agentId }),
    ])
      .then(([definition, rows]) => {
        if (cancelled || requestRevision !== revision.current) return;
        const typed = definition as unknown as AgentDefinition;
        apply({
          agentId,
          definition: typed,
          tools: typed.tools ?? {},
          rows: new Map(rows.map((row) => [row.name, row])),
          pending: new Map(),
        });
      })
      .catch((error) => {
        log.error("load tools failed", error);
        if (!cancelled) setFailure({ agentId, message: String(error) });
      });
    return () => {
      cancelled = true;
      mounted.current = false;
      flush();
    };
  }, [agentId, apply, flush, loadEpoch]);

  const setToolEnabled = useCallback(
    (name: string, enabled: boolean) => {
      setFailure(null);
      const previous = current.current;
      if (!previous || previous.agentId !== agentId) return;
      const row = previous.rows.get(name);
      if (!row || row.capabilityBlocked || row.systemPinned) return;
      const allowed = new Set(previous.tools.userAllowedTools ?? []);
      const excluded = new Set(previous.tools.excludedTools ?? []);
      if (enabled) {
        allowed.add(name);
        excluded.delete(name);
      } else {
        allowed.delete(name);
        excluded.add(name);
      }
      const next: Snapshot = {
        ...previous,
        tools: {
          ...previous.tools,
          userAllowedTools: [...allowed],
          excludedTools: [...excluded],
        },
        pending: new Map(previous.pending).set(name, enabled),
      };
      apply(next);
      pendingSave.current = { snapshot: next, revision: ++revision.current };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 400);
    },
    [agentId, apply, flush]
  );

  const visible = snapshot?.agentId === agentId ? snapshot : null;
  const tools = visible?.tools;
  const userAllowedTools = useMemo(
    () => new Set(tools?.userAllowedTools ?? []),
    [tools]
  );
  const excludedTools = useMemo(
    () => new Set(tools?.excludedTools ?? []),
    [tools]
  );
  return {
    loaded: visible !== null,
    error: failure?.agentId === agentId ? failure.message : null,
    retry: () => {
      setFailure(null);
      setLoadEpoch((value) => value + 1);
    },
    builtIn: Boolean(visible?.definition.builtIn),
    agentKind:
      agentId === "builtin:os"
        ? "os"
        : agentId === "builtin:sde"
          ? "sde"
          : "custom",
    capabilities: visible?.definition.capabilities ?? {},
    systemRestrictToTools: tools?.systemRestrictToTools ?? null,
    userAllowedTools,
    excludedTools,
    resolvedToolState: (name) => visible?.rows.get(name),
    toolState: (name) => {
      const row = visible?.rows.get(name);
      if (!row || row.capabilityBlocked) return "disabled";
      if (row.systemPinned) return "system_pinned";
      return (visible?.pending.get(name) ?? row.enabled)
        ? "enabled"
        : "disabled";
    },
    setToolEnabled,
  };
}
