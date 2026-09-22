import { invoke } from "@tauri-apps/api/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { type Session, upsertSession } from "@src/store/session";

interface ChildSessionRecord {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sessionType: string;
  parentSessionId: string | null;
}
interface ParentQuery {
  id: string;
  updatedAt: string;
  phase: "idle" | "pending" | "done";
}
const MAX_CONCURRENT_QUERIES = 8;

function childRecordToSession(
  record: ChildSessionRecord,
  parentSessionId: string
): Session {
  const name = record.name?.trim() || record.sessionId;
  const markerIndex = name.indexOf(" (");
  const agentName = (
    markerIndex >= 0 ? name.slice(0, markerIndex) : name
  ).trim();
  return {
    session_id: record.sessionId,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    created_time: record.createdAt,
    updated_time: record.updatedAt,
    name,
    category: "rust_agent",
    keySource: "own_key",
    parentSessionId: record.parentSessionId ?? parentSessionId,
    background: true,
    agentDisplayName: agentName || undefined,
  };
}

/** Cache size follows current parent inventory; retired queries can never write children back. */
export function useSidebarChildSessions(
  parents: readonly Session[],
  enabled: boolean
) {
  const queries = useRef(new Map<string, ParentQuery>());
  const active = useRef(false);
  const running = useRef(0);
  const [fetched, setFetched] = useState<ReadonlyMap<string, Session[]>>(
    new Map()
  );
  const pump = useCallback(function pumpQueries() {
    if (!active.current) return;
    for (const query of queries.current.values()) {
      if (running.current >= MAX_CONCURRENT_QUERIES) break;
      if (query.phase !== "idle") continue;
      query.phase = "pending";
      running.current++;
      void invoke<ChildSessionRecord[]>("es_get_child_sessions", {
        parentSessionId: query.id,
      })
        .then((records) => {
          // Parent removal/replacement retires this token, even if the same id
          // reappears before the old response arrives. Guard the producing write.
          if (!active.current || queries.current.get(query.id) !== query)
            return;
          const children = records.map((record) =>
            childRecordToSession(record, query.id)
          );
          for (const child of children) upsertSession(child);
          setFetched((previous) => {
            if (!active.current || queries.current.get(query.id) !== query)
              return previous;
            return new Map(previous).set(query.id, children);
          });
        })
        .catch(() => undefined)
        .finally(() => {
          running.current--;
          query.phase = active.current ? "done" : "idle";
          pumpQueries();
        });
    }
  }, []);

  // Retire tokens at commit, before a queued IPC completion can write stale children.
  useLayoutEffect(() => {
    active.current = enabled;
    const previousQueries = queries.current;
    const nextQueries = new Map<string, ParentQuery>();
    for (const parent of parents) {
      const previous = previousQueries.get(parent.session_id);
      const updatedAt = parent.updated_at ?? "";
      nextQueries.set(
        parent.session_id,
        previous?.updatedAt === updatedAt
          ? previous
          : { id: parent.session_id, updatedAt, phase: "idle" }
      );
    }
    queries.current = nextQueries;
    setFetched((previous) => {
      if ([...previous.keys()].every((id) => nextQueries.has(id)))
        return previous;
      return new Map([...previous].filter(([id]) => nextQueries.has(id)));
    });
    pump();
  }, [parents, enabled, pump]);

  useLayoutEffect(
    () => () => {
      active.current = false;
      queries.current.clear();
    },
    []
  );
  return fetched;
}
