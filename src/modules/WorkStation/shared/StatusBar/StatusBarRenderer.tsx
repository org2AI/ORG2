/**
 * StatusBarRenderer Component
 *
 * Reads per-app status bar state via activeStatusBarStateAtom and
 * activeStatusBarCallbacksAtom, then renders the appropriate variant.
 *
 * Each app writes to its own slot in perAppStatusBarStateAtom.
 * When the active app changes (via activeStatusBarAppAtom), this component
 * instantly shows the correct app's status bar — no stale data.
 */
import { useAtomValue } from "jotai";
import React, { memo } from "react";

import {
  activeStatusBarCallbacksAtom,
  activeStatusBarStateAtom,
} from "@src/store/ui/workStationLayout/statusBarAtoms";

import BrowserStatusBar from "./BrowserStatusBar";
import { EditorStatusBar } from "./EditorStatusBar";
import ProjectStatusBar from "./ProjectStatusBar";

export const StatusBarRenderer: React.FC = memo(() => {
  const state = useAtomValue(activeStatusBarStateAtom);
  const callbacks = useAtomValue(activeStatusBarCallbacksAtom);

  if (state.appType === "browser") {
    return (
      <BrowserStatusBar
        errorCount={state.browserErrorCount ?? 0}
        warningCount={state.browserWarningCount ?? 0}
        onToggleDevTools={callbacks.onToggleDevTools ?? (() => {})}
        hasSelectedElement={state.browserHasSelectedElement}
        selectedElementLabel={state.browserSelectedElementLabel}
        onSendSelectedElementToChat={callbacks.onSendSelectedElementToChat}
        onClearSelectedElement={callbacks.onClearSelectedElement}
      />
    );
  }

  if (state.appType === "project") {
    return (
      <ProjectStatusBar
        activeMemberCount={state.projectActiveMemberCount}
        totalMemberCount={state.projectTotalMemberCount}
        workItemCount={state.projectWorkItemCount}
        projectSlug={state.projectSlug}
        projectOrgId={state.projectOrgId}
        projectOrgName={state.projectOrgName}
        projectOrgGitFolderSyncEnabled={state.projectOrgGitFolderSyncEnabled}
      />
    );
  }

  return (
    <EditorStatusBar
      cursor={state.cursor}
      filePath={state.filePath || undefined}
      totalLines={state.totalLines}
      commitInfo={state.commitInfo}
      onRepoClick={callbacks.onRepoClick}
      onBranchClick={callbacks.onBranchClick}
      onWorktreeClick={callbacks.onWorktreeClick}
    />
  );
});

StatusBarRenderer.displayName = "StatusBarRenderer";

export default StatusBarRenderer;
