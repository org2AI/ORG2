import { useAtomValue } from "jotai";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";

import { getSessionGroupKey } from "@src/config/sessionAgentGroups";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import type { Session } from "@src/store/session";

import { getDateGroup } from "../useSessionMenuItems/dateGroupingHelpers";
import { workspaceGroupKey } from "../workspaceGroupKey";

const MAX_RETAINED_VIEW_ENTRIES = 256;
interface ViewState {
  scope: string;
  counts: Map<string, number>;
  expanded: Set<string>;
}

function bound<K, V>(values: Map<K, V>, allowed: ReadonlySet<K>): Map<K, V> {
  const entries = [...values]
    .filter(([key]) => allowed.has(key))
    .slice(-MAX_RETAINED_VIEW_ENTRIES);
  return entries.length === values.size ? values : new Map(entries);
}

/** App-owned view intent survives route changes, but not deleted entities or identity/scope changes. */
export function useSidebarRosterViewState(
  orgScope: string,
  sessions: readonly Session[]
) {
  const auth = useAtomValue(org2CloudAuthAtom);
  const scope = JSON.stringify([
    auth ? org2CloudAuthIdentityKey(auth) : "local",
    orgScope,
  ]);
  const inventory = useMemo(() => {
    const ids = new Set<string>();
    const groups = new Set<string>();
    for (const session of sessions) {
      ids.add(session.session_id);
      if (session.pinned) groups.add("pinned");
      else {
        groups.add("sessions");
        groups.add(`time:${getDateGroup(session)}`);
        groups.add(`workspace:${workspaceGroupKey(session)}`);
        groups.add(
          session.agentOrgId
            ? `agent-org:${session.agentOrgId}`
            : `agent:${getSessionGroupKey(session.session_id)}`
        );
      }
    }
    return { ids, groups };
  }, [sessions]);
  const [stored, setStored] = useState<ViewState>(() => ({
    scope,
    counts: new Map(),
    expanded: new Set(),
  }));
  const reconcile = useCallback(
    (value: ViewState): ViewState => {
      if (value.scope !== scope)
        return { scope, counts: new Map(), expanded: new Set() };
      const counts = bound(value.counts, inventory.groups);
      const expandedEntries = [...value.expanded]
        .filter((id) => inventory.ids.has(id))
        .slice(-MAX_RETAINED_VIEW_ENTRIES);
      const expanded =
        expandedEntries.length === value.expanded.size
          ? value.expanded
          : new Set(expandedEntries);
      return counts === value.counts && expanded === value.expanded
        ? value
        : { scope, counts, expanded };
    },
    [scope, inventory]
  );
  const current = useMemo(() => reconcile(stored), [reconcile, stored]);
  // React's conditional render reconciliation prevents one frame of old-scope
  // intent, and physically drops deleted keys rather than only masking them.
  if (current !== stored) setStored(current);
  const setGroupVisibleCounts: Dispatch<SetStateAction<Map<string, number>>> =
    useCallback(
      (update) => {
        setStored((previous) => {
          const base = reconcile(previous);
          return reconcile({
            ...base,
            counts: typeof update === "function" ? update(base.counts) : update,
          });
        });
      },
      [reconcile]
    );
  const setExpandedSubagentParentIds: Dispatch<SetStateAction<Set<string>>> =
    useCallback(
      (update) => {
        setStored((previous) => {
          const base = reconcile(previous);
          return reconcile({
            ...base,
            expanded:
              typeof update === "function" ? update(base.expanded) : update,
          });
        });
      },
      [reconcile]
    );
  return {
    groupVisibleCounts: current.counts,
    setGroupVisibleCounts,
    expandedSubagentParentIds: current.expanded,
    setExpandedSubagentParentIds,
  };
}
