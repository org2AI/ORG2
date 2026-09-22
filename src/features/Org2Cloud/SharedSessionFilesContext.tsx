import React, { Suspense, lazy, useCallback, useMemo, useState } from "react";

import {
  MarkdownLocalFileInterceptContext,
  useMarkdownLocalFileIntercepted,
  useMarkdownLocalFileInterceptor,
} from "@src/components/MarkDown/extensions";

import { sharedFileAbsolutePath } from "./sessionSharedFileCandidates";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";

const Viewer = lazy(() => import("./SharedSessionFileViewer"));
interface Scope {
  orgId: string;
  sessionId: string;
  endpoint: string;
  repoPath?: string;
}
/**
 * The interception channel is declared beside the Markdown renderer
 * (`components/MarkDown/extensions`) so the renderer stays a leaf; this
 * feature owns the provider and the viewer it opens.
 */
const Context = MarkdownLocalFileInterceptContext;
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
      if (!scope) return false;
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
          },
        },
      });
      return true;
    },
    [scopeKey]
  );
  const value = useMemo(
    () => (scopeKey !== "null" ? open : null),
    [scopeKey, open]
  );
  return (
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
  );
}
/** True inside a shared session; false keeps normal local navigation. */
export function useIsSessionFileShared(): boolean {
  return useMarkdownLocalFileIntercepted();
}
export function useOpenSessionSharedFile(): (path: string) => boolean {
  return useMarkdownLocalFileInterceptor();
}
