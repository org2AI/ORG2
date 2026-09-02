import type { SessionEvent } from "@src/engines/SessionCore/core/types";

interface ConversationRunnerOverlay {
  runnerSessionId: string;
  turnId: string;
  eventStartIndex: number;
}

export function collectLandedTurnIds(
  rows: readonly { turnId: string; event: Pick<SessionEvent, "source"> }[]
): Set<string> {
  const landed = new Set<string>();
  for (const row of rows) {
    if (row.event.source !== "user") landed.add(row.turnId);
  }
  return landed;
}

export function selectConversationRunnerTail(
  runner: ConversationRunnerOverlay,
  events: readonly SessionEvent[]
): SessionEvent[] {
  return events
    .slice(Math.max(0, runner.eventStartIndex))
    .filter((event) => event.source !== "user");
}

export function buildConversationRunnerOverlay(
  runner: ConversationRunnerOverlay,
  events: readonly SessionEvent[],
  canonicalSessionId: string
): SessionEvent[] {
  return selectConversationRunnerTail(runner, events).map((event) => ({
    ...event,
    id: `runlive-${event.id}`,
    chunk_id: `runlive-${event.id}`,
    sessionId: canonicalSessionId,
  }));
}

/** Avoid replacing the overlay when only an unrelated queue atom changed. */
export function conversationRunnerOverlaysEqual(
  left: readonly SessionEvent[] | undefined,
  right: readonly SessionEvent[]
): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((event, index) => {
    const candidate = right[index];
    return (
      event.id === candidate?.id &&
      event.displayStatus === candidate.displayStatus &&
      event.displayText === candidate.displayText &&
      event.isDelta === candidate.isDelta &&
      event.args === candidate.args &&
      event.result === candidate.result
    );
  });
}
