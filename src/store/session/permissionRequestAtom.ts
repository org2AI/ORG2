import { atom } from "jotai";
import { atomFamily } from "jotai-family";

import type { PermissionRequestEvent } from "@src/engines/SessionCore/sync/adapters/shared";

export type PendingPermissionRequestMap = Map<
  string,
  Map<string, PermissionRequestEvent>
>;

export const pendingPermissionRequestsAtom = atom<PendingPermissionRequestMap>(
  new Map()
);
pendingPermissionRequestsAtom.debugLabel = "pendingPermissionRequestsAtom";

export function getPendingPermissionRequests(
  state: PendingPermissionRequestMap,
  sessionId: string | null | undefined
): PermissionRequestEvent[] {
  if (!sessionId) return [];
  return Array.from(state.get(sessionId)?.values() ?? []);
}

export function upsertPendingPermissionRequest(
  state: PendingPermissionRequestMap,
  request: PermissionRequestEvent
): PendingPermissionRequestMap {
  const currentSession = state.get(request.sessionId);
  if (currentSession?.get(request.requestId) === request) return state;

  const nextSession = new Map(currentSession);
  nextSession.set(request.requestId, request);
  const next = new Map(state);
  next.set(request.sessionId, nextSession);
  return next;
}

export function clearFinalizedPermissionRequest(
  state: PendingPermissionRequestMap,
  sessionId: string,
  identity: { requestId?: string; toolCallId?: string }
): PendingPermissionRequestMap {
  const currentSession = state.get(sessionId);
  if (!currentSession) return state;
  const matchingRequest = Array.from(currentSession.values()).find((request) =>
    identity.requestId
      ? request.requestId === identity.requestId
      : !!identity.toolCallId && request.toolCallId === identity.toolCallId
  );
  return matchingRequest
    ? clearPendingPermissionRequest(state, sessionId, matchingRequest.requestId)
    : state;
}

export function clearPendingPermissionRequest(
  state: PendingPermissionRequestMap,
  sessionId: string,
  requestId: string
): PendingPermissionRequestMap {
  const currentSession = state.get(sessionId);
  if (!currentSession?.has(requestId)) return state;

  const next = new Map(state);
  const nextSession = new Map(currentSession);
  nextSession.delete(requestId);
  if (nextSession.size === 0) next.delete(sessionId);
  else next.set(sessionId, nextSession);
  return next;
}

const EMPTY_REQUESTS: PermissionRequestEvent[] = [];
export const permissionRequestsForSessionAtomFamily = atomFamily(
  (sessionId: string) => {
    const sessionMapAtom = atom((get) =>
      get(pendingPermissionRequestsAtom).get(sessionId)
    );
    return atom((get) => {
      const requests = get(sessionMapAtom);
      return requests ? Array.from(requests.values()) : EMPTY_REQUESTS;
    });
  }
);

export function clearSessionPermissionRequests(
  state: PendingPermissionRequestMap,
  sessionId: string
): PendingPermissionRequestMap {
  if (!state.has(sessionId)) return state;
  const next = new Map(state);
  next.delete(sessionId);
  return next;
}
