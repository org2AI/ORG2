type AgentOrgStateChangeSubscriber = (sessionId: string) => void;

const agentOrgStateChangeSubscribers = new Set<AgentOrgStateChangeSubscriber>();

export function publishAgentOrgStateChange(sessionId: string): void {
  for (const subscriber of agentOrgStateChangeSubscribers) {
    subscriber(sessionId);
  }
}

/**
 * Invalidates cached Agent Org projections after a local mutation. Backend
 * pushes cover background activity; the store keeps a slow recovery read for
 * missed events.
 */
export function subscribeAgentOrgStateChanges(
  subscriber: AgentOrgStateChangeSubscriber
): () => void {
  agentOrgStateChangeSubscribers.add(subscriber);
  return () => agentOrgStateChangeSubscribers.delete(subscriber);
}
