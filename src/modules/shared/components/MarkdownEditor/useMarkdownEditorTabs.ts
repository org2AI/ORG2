import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function useMarkdownEditorTabs() {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { key: "edit", label: t("common:actions.edit") },
      {
        key: "preview",
        label: t("common:common.preview"),
      },
    ],
    [t]
  );
}
