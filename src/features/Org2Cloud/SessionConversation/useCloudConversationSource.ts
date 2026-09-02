import { atom, useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

import type { ConversationSource } from "@src/engines/SessionCore/conversations/conversationTypes";
import { resolveForkWorkspacePath } from "@src/features/TeamCollaboration/forkWorkspaceResolution";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import type { Repo } from "@src/store/repo";
import type { Session } from "@src/store/session";
import { getExternalHistoryCliAgentType } from "@src/util/session/sessionDispatch";

import {
  type CloudOrgRemoteSessionsEntry,
  org2CloudRemoteSessionsAtom,
} from "../org2CloudRemoteSessionsAtom";
import { useCloudSessionLoadingSource } from "../useCloudSessionDownloadSurface";

const detachedRemoteSessionsAtom = atom<
  Record<string, CloudOrgRemoteSessionsEntry>
>({});

export function conversationSourceFromCloudReplay(params: {
  importedFrom?: Session["importedFrom"];
  orgId?: string;
  remoteSession?: RemoteTeammateSessionMetadata;
  sessionName?: string;
  workspaceRepoPath: string | null;
}): ConversationSource | undefined {
  const orgId = params.importedFrom?.orgId ?? params.orgId;
  const sourceSessionId =
    params.importedFrom?.sourceSessionId ??
    params.remoteSession?.sourceSessionId;
  if (!orgId || !sourceSessionId) return undefined;
  const rootId =
    params.remoteSession?.forkedFrom?.rootSessionId ?? sourceSessionId;
  return {
    root: {
      authority: "org2-cloud",
      authorityScope: [orgId],
      conversationId: rootId,
    },
    sourceTitle:
      params.sessionName ?? params.remoteSession?.title ?? "Conversation",
    cliAgentType:
      params.importedFrom?.sourceDisplay?.cliAgentType ??
      params.remoteSession?.cliAgentType ??
      getExternalHistoryCliAgentType(rootId),
    agentDefinitionId:
      params.importedFrom?.sourceDisplay?.agentDefinitionId ??
      params.remoteSession?.agentDefinitionId,
    agentDisplayName:
      params.importedFrom?.sourceDisplay?.agentDisplayName ??
      params.remoteSession?.agentDisplayName,
    model:
      params.importedFrom?.sourceDisplay?.model ?? params.remoteSession?.model,
    initialTarget: null,
    workspaceRepoPath: params.workspaceRepoPath,
  };
}

interface CloudConversationSourceInput {
  sessionId: string | null | undefined;
  session?: Session;
  sessions: readonly Session[];
  repos: readonly Repo[];
}

interface CloudConversationSourceResolution {
  source: ConversationSource | undefined;
  workspacePending: boolean;
}

/** Resolve Cloud replay identity and its device-local checkout at the edge. */
export function useCloudConversationSource({
  sessionId,
  session,
  sessions,
  repos,
}: CloudConversationSourceInput): CloudConversationSourceResolution {
  const loadingSource = useCloudSessionLoadingSource(sessionId);
  const importedFrom = session?.importedFrom;
  const remoteEntries = useAtomValue(
    importedFrom || loadingSource
      ? org2CloudRemoteSessionsAtom
      : detachedRemoteSessionsAtom
  );
  const importedRemoteRow = useMemo(() => {
    if (importedFrom) {
      return (
        remoteEntries[importedFrom.orgId]?.rows.find(
          (candidate) =>
            candidate.sourceSessionId === importedFrom.sourceSessionId
        ) ?? loadingSource
      );
    }
    return loadingSource;
  }, [importedFrom, loadingSource, remoteEntries]);
  const importedOrgId = importedFrom?.orgId ?? loadingSource?.orgId;
  const importedWorkspaceKey = importedRemoteRow
    ? `${importedOrgId ?? ""}:${importedRemoteRow.id}`
    : null;
  const [importedWorkspaceResolution, setImportedWorkspaceResolution] =
    useState<{ key: string; path: string | null } | null>(null);
  const localWorkspaceInventoryKey = useMemo(
    () =>
      [
        ...repos.map((repo) => repo.path),
        ...sessions
          // Imported rows may contain another device's absolute path. They
          // are the input being resolved, never evidence that this machine's
          // local workspace inventory has hydrated.
          .filter((candidate) => !candidate.importedFrom)
          .flatMap((candidate) => [
            candidate.repoRootPath,
            candidate.worktreePath,
            candidate.repoPath,
          ]),
      ]
        .filter((path): path is string => Boolean(path))
        .sort()
        .join("\n"),
    [repos, sessions]
  );

  useEffect(() => {
    let cancelled = false;
    if (!importedRemoteRow || !importedWorkspaceKey) return;
    // A scoped Team Session needs the local repo/session inventory before a
    // missing match is authoritative. Keep the prior durable choice pending
    // during cold-start hydration instead of collapsing it to null.
    if (importedRemoteRow.repoScopeKey && !localWorkspaceInventoryKey) return;
    void resolveForkWorkspacePath(importedRemoteRow).then((path) => {
      if (!cancelled) {
        setImportedWorkspaceResolution({ key: importedWorkspaceKey, path });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [importedRemoteRow, importedWorkspaceKey, localWorkspaceInventoryKey]);

  const workspacePending = Boolean(
    importedRemoteRow &&
    importedWorkspaceKey &&
    importedWorkspaceResolution?.key !== importedWorkspaceKey
  );
  const importedWorkspacePath =
    importedWorkspaceResolution?.key === importedWorkspaceKey
      ? importedWorkspaceResolution.path
      : null;
  const source = useMemo(
    () =>
      conversationSourceFromCloudReplay({
        importedFrom,
        orgId: importedOrgId,
        remoteSession: importedRemoteRow,
        sessionName: session?.name,
        // Imported rows may carry the owner's absolute path. Only the shared
        // repo-scope resolver may produce a workspace for this device.
        workspaceRepoPath: importedWorkspacePath,
      }),
    [
      importedFrom,
      importedOrgId,
      importedRemoteRow,
      importedWorkspacePath,
      session?.name,
    ]
  );

  return useMemo(
    () => ({ source, workspacePending }),
    [source, workspacePending]
  );
}
