import type { SwitchScope } from "@src/api/http/git/branchSwitch";
import { branchSwitchQuestion } from "@src/features/GitDialogs/BranchSwitchQuestion";
import i18n from "@src/i18n";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { isWithinWorktree, switchEditors } from "./branchSwitchEditors";

export async function ensureSwitchWorkspaceReady(
  scope: SwitchScope,
  { confirmActiveTask = false }: { confirmActiveTask?: boolean } = {}
): Promise<boolean> {
  if (!scope.repoPath) return true;
  const root = scope.repoPath;
  // A running agent does not block the switch; warn once so it is a choice.
  if (confirmActiveTask) {
    const active = getInstrumentedStore()
      .get(sessionsAtom)
      .some(
        (s) =>
          ["running", "in_progress", "installing"].includes(s.status) &&
          Boolean(s.worktreePath || s.repoPath) &&
          isWithinWorktree(s.worktreePath || s.repoPath || "", root)
      );
    if (
      active &&
      !(await branchSwitchQuestion(
        i18n.t("common:git.branchSwitch.activeTask"),
        i18n.t("common:git.branchSwitch.activeTaskDescription"),
        i18n.t("common:git.branchSwitch.switchAnyway")
      ))
    )
      return false;
  }
  // Structured file editors own save formats outside the text-buffer registry.
  // Their dirty tab flag is authoritative: require an explicit save in that editor.
  const { workstationTabsStateAtom } =
    await import("@src/store/workstation/tabs/atoms");
  const tabs = getInstrumentedStore().get(workstationTabsStateAtom);
  const workspaces = [
    tabs.shared,
    tabs.globalWorkspace,
    ...Object.values(tabs.sessionWorkspaces),
    ...Object.values(tabs.directoryWorkspaces || {}),
  ];
  const dirtyPreview = workspaces
    .flatMap((workspace) => workspace.tabs)
    .find((tab) => {
      const path = tab.data.filePath ?? tab.data.path;
      return (
        tab.hasUnsavedChanges &&
        typeof path === "string" &&
        isWithinWorktree(path, root) &&
        /\.(csv|tsv|xlsx?|ods)$/i.test(path)
      );
    });
  if (dirtyPreview) {
    await branchSwitchQuestion(
      i18n.t("common:git.branchSwitch.saveTitle"),
      i18n.t("common:git.branchSwitch.savePreview")
    );
    return false;
  }
  const { getDirtyCachedPaths, saveCachedBufferForSwitch } =
    await import("@src/modules/WorkStation/CodeEditor/hooks/fileContent/cache");
  const { getGitDiffDraftPaths, saveGitDiffDraftForSwitch } =
    await import("@src/store/workstation/codeEditor/gitDiffEditDrafts");
  const mounted = switchEditors(root);
  const dirty = mounted.filter((e) => e.dirty());
  const cached = getDirtyCachedPaths().filter(
    (p) => isWithinWorktree(p, root) && !mounted.some((e) => e.path === p)
  );
  const diffs = getGitDiffDraftPaths().filter(
    (p) => isWithinWorktree(p, root) && !mounted.some((e) => e.path === p)
  );
  // Two editors with divergent buffers for the same file must not overwrite one another.
  const paths = [...dirty.map((e) => e.path), ...cached, ...diffs];
  if (new Set(paths).size !== paths.length) {
    await branchSwitchQuestion(
      i18n.t("common:git.branchSwitch.saveFailed"),
      i18n.t("common:git.branchSwitch.multipleBuffers")
    );
    return false;
  }
  if (!paths.length) return true;
  const accepted = await branchSwitchQuestion(
    i18n.t("common:git.branchSwitch.saveTitle"),
    i18n.t("common:git.branchSwitch.saveDescription"),
    i18n.t("common:git.branchSwitch.saveContinue")
  );
  if (!accepted) return false;
  try {
    for (const e of dirty) await e.save();
    for (const p of cached) await saveCachedBufferForSwitch(p);
    for (const p of diffs) await saveGitDiffDraftForSwitch(p);
    if (
      switchEditors(root).some((e) => e.dirty()) ||
      getDirtyCachedPaths().some((p) => isWithinWorktree(p, root)) ||
      getGitDiffDraftPaths().some((p) => isWithinWorktree(p, root))
    )
      throw new Error(i18n.t("common:git.branchSwitch.editedWhileSaving"));
    return true;
  } catch (error) {
    await branchSwitchQuestion(
      i18n.t("common:git.branchSwitch.saveFailed"),
      String(error)
    );
    return false;
  }
}
