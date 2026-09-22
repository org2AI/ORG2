import { useAtomValue } from "jotai";
import { useMemo } from "react";

import useWorkspaceChat from "@src/engines/ChatPanel/hooks/useWorkspaceChat";
import { useRepositoryInfo } from "@src/engines/SessionCore";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import {
  isPendingCancelAtom,
  isSessionActiveAtom,
  sessionRuntimeStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { sessionByIdAtom } from "@src/store/session/sessionAtom/atoms";
import { wpReadOnlyAtom } from "@src/store/ui/chatPanel/miscAtoms";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace";

import {
  resolveInputAreaWorkingState,
  useInputAreaChatRoundCount,
  useInputAreaComposerStopBlockingWork,
  useInputAreaPlanMentionSource,
  useInputAreaRunnerTurnActive,
} from "./inputAreaEventSelectors";

interface UseInputAreaSessionStateOptions {
  propSessionId: string | undefined;
  controlSessionId: string | null | undefined;
  sessionScope: "active" | "none";
  executionControlsEnabled: boolean;
}

export function useInputAreaSessionState({
  propSessionId,
  controlSessionId,
  sessionScope,
  executionControlsEnabled,
}: UseInputAreaSessionStateOptions) {
  // Toolbar (workspace) repo — used as the fallback when no session is active
  // (creator mode) or the active session row predates the per-session
  // `repo_path` column.
  const { repoPath: workspaceRepoPath } = useRepositoryInfo();

  // ============================================
  // Workspace Chat
  // ============================================

  const conversationRunnerTurnActive = useInputAreaRunnerTurnActive(
    controlSessionId ?? null
  );

  const {
    handleSessInputChange,
    handleSessChatSubmit,
    stopSession,
    resumeSession,
    isHosted,
    canStopAgent,
    canResume,
  } = useWorkspaceChat({
    sessionId: propSessionId,
    sessionScope,
    controlSessionId,
  });

  // ============================================
  // Atoms (Global State)
  // ============================================

  const wpReadOnly = useAtomValue(wpReadOnlyAtom);
  const rawIsSessionActive = useAtomValue(isSessionActiveAtom);
  const rawIsPendingCancel = useAtomValue(isPendingCancelAtom);
  const runtimeStatus = useAtomValue(sessionRuntimeStatusAtom);
  const isSessionless = sessionScope === "none";
  const isSessionActive = isSessionless ? false : rawIsSessionActive;
  const isPendingCancel = isSessionless ? false : rawIsPendingCancel;

  const chatRoundCount = useInputAreaChatRoundCount();
  const planMentionSource = useInputAreaPlanMentionSource();
  // Retry is only meaningful for `failed` runs. A user-initiated cancel should
  // never surface the orange retry button — the user stopped on purpose.
  const isSessionTerminal = !isSessionless && runtimeStatus === "failed";

  // We deliberately use the `useSessionId` "active" form so the composer
  // tracks whichever session the user is currently viewing in chat —
  // matches the read path used by the pills.
  const { sessionId: resolvedActiveSessionId } = useSessionId({
    propSessionId,
  });
  const activeSessionId =
    sessionScope === "none"
      ? undefined
      : (propSessionId ?? resolvedActiveSessionId);
  const draftSessionId = activeSessionId ?? "";
  const hasComposerStopBlockingWork = useInputAreaComposerStopBlockingWork(
    activeSessionId,
    runtimeStatus
  );

  // Visual "agent is working" flag — drives the Stop vs. Send icon.
  // This uses the composer-specific gate: foreground tools remain stoppable,
  // while background processes and hidden status sentinels stay in footer/replay
  // surfaces without keeping the main button stuck in Stop.
  const isWpGeneWorking = resolveInputAreaWorkingState({
    runnerSessionId: controlSessionId ?? null,
    runnerTurnActive: conversationRunnerTurnActive,
    sourceSessionActive: isSessionActive,
    hasComposerStopBlockingWork,
    pendingCancel: isPendingCancel,
    executionControlsEnabled,
  });

  // Session-scoped repo path. When a session is active prefer its persisted
  // `repo_path` (the value that drove `workspace_root` at session start) over
  // the global repo selection atom. This keeps every input-area consumer —
  // composer bar, ContextInfoButton's `policies_list` lookup, file-prewarm
  // effect — aligned with the *session*'s repo, even when the global selection
  // has since navigated to a different project. Falls back to the global
  // selection value for creator mode and older session rows without repo_path.
  const activeSession = useAtomValue(sessionByIdAtom(activeSessionId ?? ""));
  const activeWorkspaceRootPath = useAtomValue(activeWorkspaceRootPathAtom);
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);
  const currentRepoPath = activeSessionId
    ? (activeSession?.repoPath ?? workspaceRepoPath)
    : workspaceRepoPath;
  const skillWorkspacePaths = useMemo(() => {
    const roots = new Set<string>();
    for (const folder of workspaceFolders) {
      const normalizedPath = folder.path.replace(/\/+$/, "");
      if (normalizedPath) roots.add(normalizedPath);
    }
    for (const path of [currentRepoPath, activeWorkspaceRootPath]) {
      const normalizedPath = path?.replace(/\/+$/, "");
      if (normalizedPath) roots.add(normalizedPath);
    }
    return [...roots];
  }, [activeWorkspaceRootPath, currentRepoPath, workspaceFolders]);

  return {
    handleSessInputChange,
    handleSessChatSubmit,
    stopSession,
    resumeSession,
    isHosted,
    canStopAgent,
    canResume,
    wpReadOnly,
    isSessionActive,
    isPendingCancel,
    isSessionTerminal,
    chatRoundCount,
    planMentionSource,
    activeSessionId,
    draftSessionId,
    isWpGeneWorking,
    activeSession,
    currentRepoPath,
    skillWorkspacePaths,
  };
}
