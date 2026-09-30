import { atom } from "jotai";

import { invokeTauri } from "@src/util/platform/tauri/init";

import { removeSubagentJobAtom, subagentJobMapAtom } from "./subagentJobAtom";

export const stoppingSubagentJobsAtom = atom<ReadonlySet<string>>(
  new Set<string>()
);

/** Both composer and Trail stop only a job owned by the requested parent.
 * Durable child outcome still comes from the backend, never an optimistic label. */
export const stopSubagentJobAtom = atom(
  null,
  async (get, set, request: { parentSessionId: string; handle: string }) => {
    if (
      !get(subagentJobMapAtom).get(request.parentSessionId)?.has(request.handle)
    )
      return;
    if (get(stoppingSubagentJobsAtom).has(request.handle)) return;
    set(
      stoppingSubagentJobsAtom,
      new Set([...get(stoppingSubagentJobsAtom), request.handle])
    );
    try {
      await invokeTauri("agent_kill_subagent_job", { handle: request.handle });
    } catch (error: unknown) {
      if (String(error).includes("not found")) {
        set(removeSubagentJobAtom, { handle: request.handle });
      } else throw error;
    } finally {
      const pending = new Set(get(stoppingSubagentJobsAtom));
      pending.delete(request.handle);
      set(stoppingSubagentJobsAtom, pending);
    }
  }
);
