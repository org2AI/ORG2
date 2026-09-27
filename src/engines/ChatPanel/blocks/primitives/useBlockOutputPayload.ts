import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import {
  getLoadedPayload,
  getPayloadRegistryKey,
  trackPendingPayloadLoad,
  unloadPayload,
} from "@src/engines/SessionCore/payloads";

export function useBlockOutputPayload(
  sessionId: string | undefined,
  eventId: string | undefined,
  fieldPath: string | undefined,
  onLoaded?: (body: string) => void
) {
  const key =
    sessionId && eventId && fieldPath
      ? getPayloadRegistryKey(sessionId, eventId, fieldPath)
      : null;
  const scope = useMemo(() => ({ key }), [key]);
  const activeScope = useRef<typeof scope | null>(null);
  const requestRef = useRef<object | null>(null);
  const [state, setState] = useState(() => ({
    scope,
    body: key ? getLoadedPayload(key) : null,
    loading: false,
    error: null as string | null,
  }));
  if (state.scope !== scope) {
    // Release the previous full body, even if the next output remains a
    // preview forever. Hiding it in the projection alone retains its memory.
    setState({
      scope,
      body: key ? getLoadedPayload(key) : null,
      loading: false,
      error: null,
    });
  }
  useLayoutEffect(() => {
    activeScope.current = scope;
    requestRef.current = null;
    return () => {
      activeScope.current = null;
      requestRef.current = null;
    };
  }, [scope]);

  const load = useCallback(async () => {
    if (
      !key ||
      !sessionId ||
      !eventId ||
      !fieldPath ||
      activeScope.current !== scope ||
      requestRef.current
    )
      return;
    const request = {};
    requestRef.current = request;
    const isCurrent = () =>
      activeScope.current === scope && requestRef.current === request;
    setState({ scope, body: null, loading: true, error: null });
    try {
      const cached = getLoadedPayload(key);
      const body =
        cached ??
        (await trackPendingPayloadLoad(key, () =>
          eventStoreProxy
            .loadEventPayload(sessionId, eventId, fieldPath)
            .then((payload) => payload?.body ?? null)
        ));
      if (!isCurrent()) return;
      setState({ scope, body, loading: false, error: null });
      if (body !== null) onLoaded?.(body);
    } catch (error) {
      if (!isCurrent()) return;
      setState({
        scope,
        body: null,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, [key, sessionId, eventId, fieldPath, scope, onLoaded]);

  const unload = useCallback(() => {
    if (!key) return;
    requestRef.current = null;
    unloadPayload(key);
    setState({ scope, body: null, loading: false, error: null });
  }, [key, scope]);

  return {
    key,
    body:
      state.scope === scope ? state.body : key ? getLoadedPayload(key) : null,
    loading: state.scope === scope && state.loading,
    error: state.scope === scope ? state.error : null,
    load,
    unload,
  };
}
