import React, {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { sharedFileAbsolutePath } from "./sessionSharedFileCandidates";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";

const Viewer = lazy(() => import("./SharedSessionFileViewer"));
interface Scope {
  orgId: string;
  sessionId: string;
  endpoint: string;
  repoPath?: string;
}
const Context = createContext<((path: string) => boolean) | null>(null);
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
/** Returns false outside shared sessions, preserving normal local navigation. */
const NOT_SHARED = () => false;
export function useIsSessionFileShared(): boolean {
  return useContext(Context) !== null;
}
export function useOpenSessionSharedFile(): (path: string) => boolean {
  return useContext(Context) ?? NOT_SHARED;
}
