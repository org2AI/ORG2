import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";

import {
  GITHUB_QUERY_SCOPE,
  type GitHubQueryScope,
} from "../githubWorkItemsSearchQuery";

export function GitHubWorkItemsTableEmptyState({
  scope,
  loading,
  loadError,
  allItemsCount,
  filteredItemsCount,
  repoSourcesCount,
  onRefresh,
}: {
  scope: Extract<GitHubQueryScope, "issue" | "pr">;
  loading: boolean;
  loadError: string | null;
  allItemsCount: number;
  filteredItemsCount: number;
  repoSourcesCount: number;
  onRefresh: () => void;
}): ReactNode {
  const { t } = useTranslation(["sessions", "common"]);
  if (scope !== GITHUB_QUERY_SCOPE.PR && loading && filteredItemsCount === 0) {
    return (
      <Placeholder
        variant="loading"
        placement="detail-panel"
        fillParentHeight
      />
    );
  }

  if (loadError && allItemsCount === 0) {
    return (
      <Placeholder
        variant="error"
        placement="detail-panel"
        subtitle={loadError}
        action={{ label: t("common:actions.retry"), onClick: onRefresh }}
        fillParentHeight
      />
    );
  }

  if (!loading && repoSourcesCount === 0) {
    return (
      <Placeholder variant="empty" placement="detail-panel" fillParentHeight />
    );
  }

  if (scope !== GITHUB_QUERY_SCOPE.PR && !loading && filteredItemsCount === 0) {
    return (
      <Placeholder
        variant="no-results"
        placement="detail-panel"
        fillParentHeight
      />
    );
  }

  return (
    <Placeholder
      variant={loading ? "loading" : loadError ? "error" : "no-results"}
      placement="detail-panel"
      subtitle={loadError ?? undefined}
      action={
        loadError
          ? {
              label: t("common:actions.retry"),
              onClick: onRefresh,
            }
          : undefined
      }
      fillParentHeight
    />
  );
}
