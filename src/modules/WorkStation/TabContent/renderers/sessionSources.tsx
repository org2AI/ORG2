import { useAtomValue } from "jotai";
import React from "react";

import { SessionSourcesFileScope } from "@src/engines/ChatPanel/sessionSources/SessionSourcesFileScope";
import { useSessionSourcesState } from "@src/engines/ChatPanel/sessionSources/useSessionSources";
import { SessionSourcesView } from "@src/features/SessionSources/SessionSourcesView";
import { sessionByIdAtom } from "@src/store/session";

import type { UnifiedTabContentProps } from "../types";

function SessionSourcesContent({ sessionId }: { sessionId: string }) {
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

export default function SessionSourcesTabRenderer({
  tab,
  isActive,
}: UnifiedTabContentProps) {
  const sessionId =
    typeof tab.data.sessionId === "string" ? tab.data.sessionId.trim() : "";
  // Inactive tabs must not read history or resolve thumbnails. Remounting also
  // resets pagination/gallery state when a different conversation owns the tab.
  if (!isActive) return null;
  return <SessionSourcesContent key={sessionId} sessionId={sessionId} />;
}
