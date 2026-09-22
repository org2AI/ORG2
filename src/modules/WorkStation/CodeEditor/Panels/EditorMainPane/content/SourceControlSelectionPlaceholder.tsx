import { useTranslation } from "react-i18next";

import { PLACEHOLDER_TOKENS, Placeholder } from "@src/components/Placeholder";
import { HugeiconsIcon, WorkflowCircle05Icon } from "@src/icons";

export function SourceControlSelectionPlaceholder({
  mode = "uncommitted",
}: {
  mode?: string;
}) {
  const { t } = useTranslation();
  const titleKey =
    mode === "stashed"
      ? "placeholders.selectSidebarStash"
      : mode === "history"
        ? "placeholders.selectSidebarCommit"
        : mode === "pr"
          ? "placeholders.selectSidebarPullRequest"
          : mode === "issues"
            ? "placeholders.selectSidebarIssue"
            : "placeholders.selectSidebarFileToViewChanges";
  return (
    <Placeholder
      variant="empty"
      placement="detail-panel"
      fillParentHeight
      title={t(titleKey)}
      icon={
        <HugeiconsIcon
          icon={WorkflowCircle05Icon}
          size={PLACEHOLDER_TOKENS.detailIconSize}
          strokeWidth={1.25}
          className="text-text-1 opacity-30"
        />
      }
    />
  );
}
