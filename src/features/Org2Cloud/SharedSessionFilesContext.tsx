import React, {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  MarkdownLocalFileInterceptContext,
  useMarkdownLocalFileIntercepted,
  useMarkdownLocalFileInterceptor,
} from "@src/components/MarkDown/extensions";
import Message from "@src/components/Message";
import {
  conversationArtifactOriginOf,
  isInheritedConversationEvent,
} from "@src/engines/SessionCore/conversations/conversationArtifactOrigin";
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
  const { t } = useTranslation("sessions");
  const waitForOrigin = useCallback(() => {
    Message.info(t("sharedFile.resolvingOrigin"), { duration: 5000 });
    return true;
  }, [t]);
  const origin = conversationArtifactOriginOf(event);
  if (!origin) {
    // Materialized native history may arrive before its authenticated cloud row.
    // Never reinterpret an unresolved inherited link as a local file (or select
    // an arbitrary latest upload without the exact uploader/revision).
    return isInheritedConversationEvent(event) ? (
      <Context.Provider value={waitForOrigin}>{children}</Context.Provider>
    ) : (
      <>{children}</>
    );
  }
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
      <SharedSessionFileAccessContext.Provider value={access}>
        <Context.Provider value={value}>
          {children}
          {selected?.key === scopeKey && (
            <Suspense
              fallback={
                <SharedSessionFileDialog
                  reference={selected.reference}
                  onClose={() => setSelected(null)}
                />
              }
            >
              <Viewer
                reference={selected.reference}
                onClose={() => setSelected(null)}
              />
            </Suspense>
          )}
        </Context.Provider>
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
