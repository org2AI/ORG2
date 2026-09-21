/**
 * PullRequestContent
 *
 * Sidebar PR list using TreeRowBase rows grouped under a collapsible
 * "OPEN" section header (same pattern as IssuesContent).
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { TYPOGRAPHY } from "@src/config/workstation/tokens";
import { HugeiconsIcon, Loading03Icon, TriangleAlertIcon } from "@src/icons";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";

import { PullRequestTreeList } from "./PullRequestTreeList";
import { usePullRequestListActions } from "./usePullRequestListActions";
import { usePullRequestListData } from "./usePullRequestListData";
import { usePullRequestSections } from "./usePullRequestSections";
import { usePullRequestVirtualList } from "./usePullRequestVirtualList";

interface PullRequestContentProps {
  branchName?: string;
  filterQuery?: string;
  onHistorySelectionChange?: (selection: SourceControlHistorySelection) => void;
  repoId?: string | null;
  repoPath?: string;
}

// ── Main component ─────────────────────────────────────────────────────────────

const PullRequestContent: React.FC<PullRequestContentProps> = ({
  branchName,
  filterQuery = "",
  onHistorySelectionChange,
  repoId,
  repoPath,
}) => {
  const { t } = useTranslation("common");
  const {
    prUrl,
    readyToCreate,
    prCreating,
    onCreatePr,
    loadClosedPrs,
    allOpenPrs,
    allClosedPrs,
    openPrsLoadState,
    openPrsError,
    closedPrsLoadState,
    closedPrsError,
  } = usePullRequestListData(repoId, repoPath);
  const { selectedPrNumber, localCreateError, handlePrClick, handleCreate } =
    usePullRequestListActions({
      onHistorySelectionChange,
      onCreatePr,
      prCreating,
    });
  const {
    openCollapsed,
    setOpenCollapsed,
    closedCollapsed,
    orderedPrs,
    filteredClosedPrs,
    handleToggleClosed,
    hasCurrentBranchPr,
    openStatus,
    openWholePane,
    virtualRows,
  } = usePullRequestSections({
    branchName,
    filterQuery,
    prUrl,
    allOpenPrs,
    allClosedPrs,
    openPrsLoadState,
    openPrsError,
    closedPrsLoadState,
    closedPrsError,
    loadClosedPrs,
    t,
  });
  const { listRef, prListVirtualizer, virtualItems } =
    usePullRequestVirtualList(virtualRows);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Create PR section */}
      {!hasCurrentBranchPr && readyToCreate && (
        <div className="flex flex-col gap-3 border-b border-border-2 p-3">
          <div>
            <p className={`${TYPOGRAPHY.secondary} text-text-2`}>
              {t(
                "labels.noPullRequestForBranch",
                "There is no pull request for this branch yet"
              )}
            </p>
          </div>
          {prCreating ? (
            <div
              className={`flex items-center gap-2 ${TYPOGRAPHY.secondary} text-text-3`}
            >
              <HugeiconsIcon
                icon={Loading03Icon}
                data-icon="loader-2"
                size={SPINNER_TOKENS.default}
                className="animate-spin text-text-3"
              />
              <span>{t("labels.creatingPullRequest", "Creating…")}</span>
            </div>
          ) : (
            <Button
              variant="primary"
              size="small"
              onClick={handleCreate}
              disabled={!onCreatePr}
              className="text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("actions.createPullRequest", "Create pull request")}
            </Button>
          )}
          {localCreateError && (
            <div className="flex items-start gap-1.5 rounded-md bg-fill-2 px-2 py-1.5">
              <HugeiconsIcon
                icon={TriangleAlertIcon}
                data-icon="triangle-alert"
                size={12}
                className="mt-0.5 shrink-0 text-warning-6"
              />
              <p
                className={`min-w-0 flex-1 ${TYPOGRAPHY.secondary} text-text-2`}
              >
                {localCreateError}
              </p>
            </div>
          )}
        </div>
      )}

      {/* PR tree list (virtualized) */}
      <PullRequestTreeList
        openCollapsed={openCollapsed}
        setOpenCollapsed={setOpenCollapsed}
        closedCollapsed={closedCollapsed}
        orderedPrs={orderedPrs}
        filteredClosedPrs={filteredClosedPrs}
        closedPrsLoadState={closedPrsLoadState}
        handleToggleClosed={handleToggleClosed}
        selectedPrNumber={selectedPrNumber}
        handlePrClick={handlePrClick}
        openWholePane={openWholePane}
        openStatus={openStatus}
        listRef={listRef}
        prListVirtualizer={prListVirtualizer}
        virtualItems={virtualItems}
        virtualRows={virtualRows}
      />
    </div>
  );
};

PullRequestContent.displayName = "PullRequestContent";

export default memo(PullRequestContent);
