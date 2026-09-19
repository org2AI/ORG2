/**
 * PrDetailPanel
 *
 * GitHub-style tabbed Pull Request detail rendered in the Source Control main
 * pane with a Conversation / Commits / Checks / Changes tab bar.
 *
 * Mounts `useWorkstationPrDetail` (which parallel-fetches every source and
 * publishes into `workstationSelectedPrAtom`) and renders each tab from that
 * shared state. The Conversation tab gets the GitHub-flow title header, and a
 * Workstation-trail details rail (reviewers / assignees / labels / merge
 * actions) stays beside the content. Reuses commit-history + issue-timeline
 * formatting throughout.
 */
import { useAtom } from "jotai";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import InlineBanner, {
  useDismissibleMessage,
} from "@src/components/InlineBanner";
import GitHubDetailSkeleton from "@src/features/GitHubWork/GitHubDetailSkeleton";
import GitHubPrDetailTabs from "@src/features/GitHubWork/GitHubPrDetailTabs";
import { useDetailRailLayout } from "@src/hooks/ui/layout/useDetailRailLayout";
import { ExternalBrowserButton } from "@src/modules/WorkStation/shared/ExternalBrowserButton";
import {
  type PrIdentity,
  workstationPrScopeKey,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import { resolvePullRequestDetailStatus } from "@src/util/git/pr/prLevelActions";

import { useWorkstationPrDetail } from "../../../hooks/useWorkstationPrDetail";
import { PrDetailSidebarRail } from "./PrDetailSidebarRail";
import { PrDetailTabPanels } from "./PrDetailTabPanels";
import { PrChecksRefreshContext } from "./prChecksRefreshContext";
import { formatPrFilesCount } from "./prFilesDisplay";
import { usePrDetailTrailRefs } from "./usePrDetailTrailRefs";
import { usePrDetailViewState } from "./usePrDetailViewState";

interface PrDetailPanelProps {
  identity: PrIdentity;
  repoPath: string;
  repoId?: string;
  /** Host-owned actions displayed at the end of the tab strip. */
  tabActions?: React.ReactNode;
  /** Render tabs in the host's header instead of above the panel body. */
  tabsPlacement?: "panel" | "hostHeader";
  onFileSelect?: (path: string) => void;
}

interface PrDetailTabsProps {
  identity: PrIdentity;
  repoPath: string;
  repoId?: string;
  trailing?: React.ReactNode;
  variant?: "row" | "header";
}

export function PrDetailExternalLinkButton({
  identity,
  title,
}: {
  identity: PrIdentity;
  title?: string;
}): React.ReactNode {
  return <ExternalBrowserButton href={identity.url} label={title} />;
}

/** Shared PR navigation, suitable for either a panel or a host-owned header. */
export const PrDetailTabs: React.FC<PrDetailTabsProps> = ({
  identity,
  repoPath,
  repoId,
  trailing,
  variant = "row",
}) => {
  const scopeKey = workstationPrScopeKey(repoId, repoPath, identity.number);
  const [state, setState] = useAtom(workstationSelectedPrAtomFamily(scopeKey));
  const activeTab = state.viewState.activeTab;

  return (
    <GitHubPrDetailTabs
      activeTab={activeTab}
      counts={
        state.loading || (state.detail === null && state.error === null)
          ? undefined
          : {
              conversation: state.conversation.length + state.reviews.length,
              commits: state.commits.length,
              checks:
                (state.checks?.check_runs.length ?? 0) +
                (state.checks?.statuses.length ?? 0),
              changes: formatPrFilesCount(state.files.length),
            }
      }
      trailing={trailing}
      variant={variant}
      onChange={(nextTab) => {
        setState((current) => ({
          ...current,
          viewState: {
            ...current.viewState,
            activeTab: nextTab,
          },
        }));
      }}
    />
  );
};

PrDetailTabs.displayName = "PrDetailTabs";

export const PrDetailPanel: React.FC<PrDetailPanelProps> = ({
  identity,
  repoPath,
  repoId,
  tabActions,
  tabsPlacement = "panel",
  onFileSelect,
}) => {
  const { t } = useTranslation("common");
  const {
    trailScrollContainerRef,
    trailContentRef,
    setTabContentNode,
    setConversationScrollNode,
    setConversationContentNode,
  } = usePrDetailTrailRefs();
  const {
    state,
    detailViewState,
    activeTab,
    setConversationDraft,
    setSelectedCommitSha,
    setSelectedChangedFilePath,
  } = usePrDetailViewState({ repoId, repoPath, prNumber: identity.number });

  const currentIdentity = useMemo(
    () => ({
      ...identity,
      status: resolvePullRequestDetailStatus(state.detail, identity.status),
    }),
    [identity, state.detail]
  );

  const { visibleMessage: visibleError, dismiss: dismissError } =
    useDismissibleMessage(state.error);

  const baseBranch =
    state.baseRef ?? identity.baseBranch ?? t("git.pr.baseBranch", "base");

  const tabs =
    tabsPlacement === "panel" ? (
      <PrDetailTabs
        identity={identity}
        repoPath={repoPath}
        repoId={repoId}
        trailing={
          tabActions ?? <PrDetailExternalLinkButton identity={identity} />
        }
      />
    ) : null;

  const loading =
    state.loading || (state.detail === null && state.error === null);
  const { paneRef, inlineRail } = useDetailRailLayout(!loading);
  // After the layout hook: its pane is the element CI polling watches, so a
  // panel parked in a background tab stops asking GitHub for checks.
  const controller = useWorkstationPrDetail({
    repoPath,
    repoId,
    pr: identity,
    visibilityRef: paneRef,
  });
  const sidebar = (
    <PrDetailSidebarRail
      currentIdentity={currentIdentity}
      state={state}
      controller={controller}
      activeTab={activeTab}
      trailScrollContainerRef={trailScrollContainerRef}
      trailContentRef={trailContentRef}
      inline={inlineRail}
    />
  );

  const checksRefresh = useMemo(
    () => ({
      refreshChecks: controller.refreshChecks,
      refreshing: state.refreshingChecks,
    }),
    [controller.refreshChecks, state.refreshingChecks]
  );

  if (loading) {
    return (
      <GitHubDetailSkeleton
        kind="pr"
        showHeader={false}
        showTabs={tabsPlacement === "panel"}
        tabs={tabs}
        activeTab={activeTab}
        title={identity.title}
        number={identity.number}
      />
    );
  }

  return (
    <PrChecksRefreshContext.Provider value={checksRefresh}>
      <div className="allow-select-deep flex h-full min-h-0 flex-col overflow-hidden">
        {tabs}

        {/* A background reconcile clears `state.error` as soon as it succeeds, so
          the strip holds the message until the reader dismisses it. */}
        {visibleError ? (
          <InlineBanner onDismiss={dismissError} dataTestId="pr-detail-error">
            {visibleError}
          </InlineBanner>
        ) : null}

        {/* Detail tabs mount lazily, then remain mounted to preserve view state. */}
        <div
          ref={paneRef}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {inlineRail && activeTab !== "conversation" ? (
            <div className="max-h-64 shrink-0 overflow-y-auto px-4 py-4">
              {sidebar}
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <PrDetailTabPanels
              identity={identity}
              currentIdentity={currentIdentity}
              repoPath={repoPath}
              repoId={repoId}
              state={state}
              detailViewState={detailViewState}
              activeTab={activeTab}
              baseBranch={baseBranch}
              controller={controller}
              setConversationDraft={setConversationDraft}
              setSelectedCommitSha={setSelectedCommitSha}
              setSelectedChangedFilePath={setSelectedChangedFilePath}
              setTabContentNode={setTabContentNode}
              setConversationScrollNode={setConversationScrollNode}
              setConversationContentNode={setConversationContentNode}
              onFileSelect={onFileSelect}
              inlineProperties={
                inlineRail && activeTab === "conversation" ? sidebar : undefined
              }
            />

            {!inlineRail ? sidebar : null}
          </div>
        </div>
      </div>
    </PrChecksRefreshContext.Provider>
  );
};

PrDetailPanel.displayName = "PrDetailPanel";
