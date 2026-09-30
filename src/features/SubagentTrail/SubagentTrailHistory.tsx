import { useMemo } from "react";

import type { SubagentSession } from "@src/contracts/simulator/subagent";
import { SubagentChatPane } from "@src/engines/Simulator/components/GridCell/SubagentChatPane";
import { useMultiSessionSimulatorEvents } from "@src/engines/Simulator/hooks/useMultiSessionSimulatorEvents";

/** History is observed for the inspected child only, never the entire roster. */
export function SubagentTrailHistory({
  session,
}: {
  session: SubagentSession;
}) {
  const children = useMemo(() => [session], [session]);
  const { loadState } = useMultiSessionSimulatorEvents(children);
  const load = loadState(session.sessionId);
  return (
    <SubagentChatPane
      sessionId={session.sessionId}
      historyLoad={load}
      isSessionLive={!session.isTerminal}
    />
  );
}
