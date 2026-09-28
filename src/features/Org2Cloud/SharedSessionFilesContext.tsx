import { atom, useStore } from "jotai";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";

import {
  MarkdownLocalFileInterceptContext,
  useMarkdownLocalFileIntercepted,
  useMarkdownLocalFileInterceptor,
} from "@src/components/MarkDown/extensions";
import {
  conversationArtifactOriginOf,
  isInheritedConversationEvent,
} from "@src/engines/SessionCore/conversations/conversationArtifactOrigin";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { openSharedSessionFile } from "./openSharedSessionFile";
import { sharedFileAbsolutePath } from "./sessionSharedFileCandidates";
import { SharedSessionFileAccessContext } from "./sharedSessionFileAccess";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";

interface Scope {
  orgId: string;
  sessionId: string;
  endpoint: string;
  repoPath?: string;
  shareToken?: string;
  /** Local owner rows retain local navigation; plane rows override this per event. */
  eventOnly?: boolean;
  version?: { uploaderUserId: string; revision: string };
}
/**
 * The interception channel is declared beside the Markdown renderer
 * (`components/MarkDown/extensions`) so the renderer stays a leaf; this
 * feature owns the provider and the viewer it opens.
 */
const Context = MarkdownLocalFileInterceptContext;
const ScopeContext = createContext<Scope | null>(null);

export function SharedSessionEventFilesProvider({
  event,
  children,
}: React.PropsWithChildren<{ event: SessionEvent }>) {
  const scope = useContext(ScopeContext);
  const store = useStore();
  const origin = conversationArtifactOriginOf(event);
  const inherited = isInheritedConversationEvent(event);
  const eventKey = JSON.stringify([
    scope?.endpoint,
    scope?.orgId,
    scope?.sessionId,
    event.id,
  ]);
  const originKey = JSON.stringify(origin ?? null);
  const originAtom = useMemo(() => {
    // Event identity owns this rendezvous; no polling or global pending map.
    void event.id;
    return atom<ReturnType<typeof conversationArtifactOriginOf> | undefined>(
      null
    );
  }, [event.id]);
  useEffect(() => {
    store.set(
      originAtom,
      JSON.parse(originKey) as ReturnType<typeof conversationArtifactOriginOf>
    );
  }, [store, originAtom, originKey]);
  useEffect(
    () => () => {
      // A resolved preview survives leaving chat. An unresolved one must not wait forever.
      if (!store.get(originAtom)) store.set(originAtom, undefined);
    },
    [store, originAtom]
  );
  const scopeKey = JSON.stringify(scope);
  const open = useCallback(
    (path: string) => {
      const scope = JSON.parse(scopeKey) as Scope | null;
      const referenceAtom = atom(
        (get): SharedSessionFileReference | null | undefined => {
          const origin = get(originAtom);
          if (!origin) return origin;
          return {
            id: "source",
            endpoint: scope?.endpoint ?? "",
            source: {
              orgId: scope?.orgId ?? "",
              sessionId: origin.sessionId,
              path: sharedFileAbsolutePath(path, origin.repoPath) ?? path,
              version: {
                uploaderUserId: origin.uploaderUserId,
                revision: origin.revision,
              },
            },
          };
        }
      );
      const reference = store.get(referenceAtom);
      openSharedSessionFile(
        reference ?? {
          id: "source",
          endpoint: scope?.endpoint ?? "",
          source: {
            orgId: scope?.orgId ?? "",
            sessionId: scope?.sessionId ?? "",
            path,
          },
        },
        scope?.shareToken
          ? { endpoint: scope.endpoint, shareToken: scope.shareToken }
          : null,
        { key: JSON.stringify([eventKey, path]), referenceAtom }
      );
      return true;
    },
    [store, originAtom, scopeKey, eventKey]
  );
  // Never interpret inherited paths as receiver-local files before origin hydration.
  return origin || inherited ? (
    <Context.Provider value={open}>{children}</Context.Provider>
  ) : (
    <>{children}</>
  );
}
export function SharedSessionFilesProvider({
  scope,
  children,
}: React.PropsWithChildren<{ scope: Scope | null }>) {
  const scopeKey = JSON.stringify(scope);
  const open = useCallback(
    (path: string) => {
      const scope = JSON.parse(scopeKey) as Scope | null;
      if (!scope || scope.eventOnly) return false;
      const absolute = sharedFileAbsolutePath(path, scope.repoPath);
      // A shared-session reference must not fall through to the receiver's disk.
      openSharedSessionFile(
        {
          id: "source",
          endpoint: scope.endpoint,
          source: {
            orgId: scope.orgId,
            sessionId: scope.sessionId,
            path: absolute ?? path,
            ...(scope.version ? { version: scope.version } : {}),
          },
        },
        scope.shareToken
          ? { endpoint: scope.endpoint, shareToken: scope.shareToken }
          : null
      );
      return true;
    },
    [scopeKey]
  );
  const value = useMemo(
    () => (scope && !scope.eventOnly ? open : null),
    [scope, open]
  );
  const endpoint = scope?.endpoint;
  const shareToken = scope?.shareToken;
  const access = useMemo(
    () => (endpoint && shareToken ? { endpoint, shareToken } : null),
    [endpoint, shareToken]
  );
  return (
    <ScopeContext.Provider value={scope}>
      <SharedSessionFileAccessContext.Provider value={access}>
        <Context.Provider value={value}>{children}</Context.Provider>
      </SharedSessionFileAccessContext.Provider>
    </ScopeContext.Provider>
  );
}
/** True inside a shared session; false keeps normal local navigation. */
export function useIsSessionFileShared(): boolean {
  return useMarkdownLocalFileIntercepted();
}
export function useOpenSessionSharedFile(): (path: string) => boolean {
  return useMarkdownLocalFileInterceptor();
}
