/**
 * SessionCreatorChatPanel — session creator wiring.
 *
 * The repository selection, the launch context (attached work item), the
 * builtin slash-control items and `useSessionCreator` itself, plus git
 * availability and the worktree launch selection for the chosen source.
 */
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";

import { useSessionCreator } from "@src/engines/SessionCore/hooks/session/useSessionCreator";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { gitDependencyInstalledAtom } from "@src/store/platform/gitDependencyAtom";

import type { SessionCreatorChatPanelSingleProps } from "./types";
import type { useChatPanelAgentMode } from "./useChatPanelAgentMode";
import { useChatPanelLaunchContext } from "./useChatPanelLaunchContext";
import { useChatPanelNativeControlItems } from "./useChatPanelNativeControlItems";
import { useChatPanelWorktreeSelection } from "./useChatPanelWorktreeSelection";

interface UseChatPanelSessionCreatorOptions extends Pick<
  SessionCreatorChatPanelSingleProps,
  | "initialContent"
  | "launchMode"
  | "onSessionStart"
  | "resolveWorkItemContext"
  | "workItemContext"
> {
  mode: ReturnType<typeof useChatPanelAgentMode>;
  multiRunnerLauncher: boolean;
  t: TFunction<"sessions">;
}

export function useChatPanelSessionCreator({
  initialContent,
  launchMode,
  mode,
  multiRunnerLauncher,
  onSessionStart,
  resolveWorkItemContext,
  t,
  workItemContext,
}: UseChatPanelSessionCreatorOptions) {
  const {
    cli: { cliComposerEnabled, defaultTuiMode },
    isHumanMode,
  } = mode;

  const {
    repos: reposList,
    selectRepo,
    currentRepo,
    branchLoading,
    forceRefreshRepos,
  } = useRepoSelection({ autoLoad: true });
  const {
    attachedWorkItemContext,
    setAttachedWorkItemContext,
    chatPanelLaunchContext,
    handleSessionStart,
  } = useChatPanelLaunchContext({
    defaultTuiMode,
    isHumanMode,
    onSessionStart,
  });

  const nativeControlItems = useChatPanelNativeControlItems({
    isHumanMode,
    multiRunnerLauncher,
    t,
  });

  const creator = useSessionCreator({
    extraSlashItems: nativeControlItems,
    initialContent,
    launchMode,
    persistDraft: !initialContent,
    skipDraftLoading: Boolean(initialContent),
    workItemContext:
      attachedWorkItemContext ?? workItemContext ?? chatPanelLaunchContext,
    resolveWorkItemContext,
    onLaunchSuccess: handleSessionStart,
    cliAgentSupportsGui: cliComposerEnabled,
  });
  const { effectiveSource } = creator;

  const gitInstalled = useAtomValue(gitDependencyInstalledAtom);
  const showMissingGitAlert = gitInstalled === false;

  const worktree = useChatPanelWorktreeSelection({ effectiveSource });

  return {
    attachedWorkItemContext,
    branchLoading,
    chatPanelLaunchContext,
    creator,
    currentRepo,
    forceRefreshRepos,
    handleSessionStart,
    reposList,
    selectRepo,
    setAttachedWorkItemContext,
    showMissingGitAlert,
    worktree,
  };
}
