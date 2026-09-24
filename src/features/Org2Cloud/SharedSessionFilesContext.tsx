import React, {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import {
  MarkdownLocalFileInterceptContext,
  useMarkdownLocalFileIntercepted,
  useMarkdownLocalFileInterceptor,
} from "@src/components/MarkDown/extensions";
import { conversationArtifactOriginOf } from "@src/engines/SessionCore/conversations/conversationArtifactOrigin";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import SharedSessionFileDialog from "./SharedSessionFileDialog";
import { sharedFileAbsolutePath } from "./sessionSharedFileCandidates";
import { SharedSessionFileAccessContext } from "./sharedSessionFileAccess";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";

const Viewer = lazy(() => import("./SharedSessionFileViewer"));
interface Scope {
  orgId: string;
  sessionId: string;
  endpoint: string;
  repoPath?: string;
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
  const origin = conversationArtifactOriginOf(event);
  if (!origin) return <>{children}</>;
  return (
    <SharedSessionFilesProvider
      scope={{
        ...(scope ?? { orgId: "", endpoint: "" }),
        sessionId: origin.sessionId,
        repoPath: origin.repoPath,
        eventOnly: false,
        version: {
          uploaderUserId: origin.uploaderUserId,
          revision: origin.revision,
        },
      }}
    >
      {children}
    </SharedSessionFilesProvider>
  );
}
export function SharedSessionFilesProvider({
  scope,
  children,
}: React.PropsWithChildren<{ scope: Scope | null }>) {
  const [selected, setSelected] = useState<{
    key: string;
    reference: SharedSessionFileReference;
  } | null>(null);
  const scopeKey = JSON.stringify(scope);
  const open = useCallback(
    (path: string) => {
      const scope = JSON.parse(scopeKey) as Scope | null;
      if (!scope || scope.eventOnly) return false;
      const absolute = sharedFileAbsolutePath(path, scope.repoPath);
      // A shared-session reference must not fall through to the receiver's disk.
      setSelected({
        key: scopeKey,
        reference: {
          id: "source",
          endpoint: scope.endpoint,
          source: {
            orgId: scope.orgId,
            sessionId: scope.sessionId,
            path: absolute ?? path,
            ...(scope.version ? { version: scope.version } : {}),
          },
        },
      });
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
      <Context.Provider value={value}>
        {children}
        {selected?.key === scopeKey && (
          <Suspense fallback={null}>
            <Viewer
              reference={selected.reference}
              onClose={() => setSelected(null)}
            />
          </Suspense>
        )}
      </Context.Provider>
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
