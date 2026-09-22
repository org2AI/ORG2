/**
 * UnifiedTabContent — single dispatcher component for all WorkStation
 * tab content. Looks up `tab.type` in `REGISTRY` and renders the
 * matching lazy renderer wrapper inside a `Suspense` boundary (so
 * switching between two already-loaded tabs of the same chunk does
 * not re-suspend).
 *
 * CodeEditor mounts this dispatcher for registry-owned tabs that do not
 * need host-coupled editor props; other hosts can mount it directly as
 * their adapters are retired.
 */
import React, { Suspense, memo } from "react";

import LazyDetailFallback from "@src/components/layout/blocks/LazyDetailFallback";
import GitHubDetailSkeleton from "@src/features/GitHubWork/GitHubDetailSkeleton";
import DetailPaneErrorBoundary from "@src/scaffold/layouts/DetailPaneErrorBoundary";
import type { WorkStationTab } from "@src/store/workstation/tabs/types";

import { UnknownTabPlaceholder } from "./UnknownTabPlaceholder";
import { REGISTRY } from "./registry";

export interface UnifiedTabContentDispatcherProps {
  tab: WorkStationTab;
  isActive: boolean;
}

export const UnifiedTabContent: React.FC<UnifiedTabContentDispatcherProps> =
  memo(({ tab, isActive }) => {
    const entry = REGISTRY[tab.type];
    if (!entry) {
      return <UnknownTabPlaceholder type={tab.type} />;
    }
    const { Component } = entry;
    const fallback =
      tab.type === "github-issue-detail" ? (
        <GitHubDetailSkeleton
          kind="issue"
          showHeader={false}
          showTabs={false}
          title={tab.data.issueTitle as string}
          number={tab.data.issueNumber as number}
        />
      ) : tab.type === "github-pr-detail" ? (
        <GitHubDetailSkeleton kind="pr" showHeader={false} showTabs={false} />
      ) : (
        <LazyDetailFallback />
      );
    // Keyed by tab id so the boundary resets when the pane is reused for a
    // different tab, and so a retry remounts the renderer rather than
    // re-rendering the failed tree.
    //
    // Without a boundary here the nearest ancestor is the application root:
    // `tab.data` is an open record restored from localStorage and every
    // renderer asserts its shape, so one tab written by an older build takes
    // the whole window down — and because the failing tab is persisted as
    // active, the next launch reproduces it.
    return (
      <DetailPaneErrorBoundary key={tab.id} label={tab.title || tab.type}>
        <Suspense fallback={fallback}>
          <Component tab={tab} isActive={isActive} />
        </Suspense>
      </DetailPaneErrorBoundary>
    );
  });

UnifiedTabContent.displayName = "UnifiedTabContent";

export default UnifiedTabContent;
