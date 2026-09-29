import { useAtomValue } from "jotai";
import React from "react";

import { SessionSourcesFileScope } from "@src/engines/ChatPanel/sessionSources/SessionSourcesFileScope";
import { useSessionSourcesState } from "@src/engines/ChatPanel/sessionSources/useSessionSources";
import { sessionByIdAtom } from "@src/store/session";

import { SessionSourcesView } from "./SessionSourcesView";

export function SessionSourcesContent({ sessionId }: { sessionId: string }) {
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const { sources, loading, error, retry } = useSessionSourcesState(
    sessionId,
    session?.updated_at
  );
  const basePath =
    session?.repoRootPath ??
    (session?.importedFrom
      ? undefined
      : (session?.worktreePath ?? session?.repoPath));
  return (
    <SessionSourcesFileScope session={session}>
      <SessionSourcesView
        sources={sources}
        basePath={basePath}
        loading={loading}
        error={error}
        onRetry={retry}
      />
    </SessionSourcesFileScope>
  );
}
