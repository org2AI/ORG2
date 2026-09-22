import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { WorkingDirectoryPaletteText } from "./types";

interface UseWorkingDirectoryPaletteTextOptions {
  isManageMode: boolean;
  switchPathLabel?: string;
  orgScopeName?: string;
}

/** Every translated string the palette and its item builders display. */
export function useWorkingDirectoryPaletteText({
  isManageMode,
  switchPathLabel,
  orgScopeName,
}: UseWorkingDirectoryPaletteTextOptions): WorkingDirectoryPaletteText {
  const { t } = useTranslation();

  return useMemo(
    () => ({
      switchPathLabel:
        switchPathLabel ??
        (isManageMode
          ? t("selectors.repo.path.manageWorkspace")
          : t("selectors.spotlight.actions.switchWorkspace.label")),
      switchPathTemplate: isManageMode
        ? t("selectors.repo.path.manageWorkspace")
        : t("selectors.spotlight.actions.switchWorkspace.label"),
      switchPlaceholder: t("selectors.spotlight.placeholders.workspace"),
      invalidPathTitle: t("selectors.repo.pathImport.invalidTitle"),
      invalidPathMessage: (path: string) =>
        t("selectors.repo.pathImport.invalidMessage", { path }),
      addPathLabel: t("selectors.spotlight.actions.addWorkspace.label"),
      addPathTemplate: t("selectors.repo.path.addByTemplate"),
      addPlaceholder: t("selectors.spotlight.placeholders.source"),
      addEntryLabel: t("selectors.repo.addEntry"),
      openFolderLabel: t("actions.openFolder"),
      addFolderLabel: t("selectors.repo.pathImport.addLabel"),
      sectionCurrentLabel: t("selectors.repo.sections.current"),
      sectionRecentLabel: t("selectors.repo.sections.recent"),
      sectionSystemPathsLabel: t("selectors.repo.sections.systemPaths"),
      sectionExternalRecentLabel: t("selectors.repo.sections.usedElsewhere"),
      sectionRepoLabel: t("selectors.repo.sections.repo"),
      sectionWorkingDirectoryLabel: t("selectors.repo.sections.workspace"),
      sectionMultiRepoWorkingDirectoryLabel: t(
        "workspaceForm.multiRepoWorkspace"
      ),
      sectionThisOrgLabel: orgScopeName ?? t("selectors.repo.sections.thisOrg"),
      sectionOutsideOrgLabel: orgScopeName
        ? t("selectors.repo.sections.outsideNamedOrg", {
            org: orgScopeName,
          })
        : t("selectors.repo.sections.outsideOrg"),
    }),
    [t, isManageMode, switchPathLabel, orgScopeName]
  );
}
