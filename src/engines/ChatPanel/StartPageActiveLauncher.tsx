import React from "react";

import { CreatorContentLayout } from "@src/components/layout/blocks";

import type { StartPageView } from "./startPageView";

interface StartPageActiveLauncherProps {
  activeView: StartPageView;
  agentLauncherContent: React.ReactNode;
  manualWorkItemLauncherContent: React.ReactNode;
  moreLauncherContent: React.ReactNode;
  showManualWorkItem: boolean;
}

/** The launcher surface for the active start-page tab. */
export function StartPageActiveLauncher({
  activeView,
  agentLauncherContent,
  manualWorkItemLauncherContent,
  moreLauncherContent,
  showManualWorkItem,
}: StartPageActiveLauncherProps): React.ReactNode {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {showManualWorkItem ? (
        <div
          className="flex h-full min-h-0 w-full"
          data-testid="chat-panel-start-page-work-item-launcher"
        >
          {manualWorkItemLauncherContent}
        </div>
      ) : activeView === "more" ? (
        <div
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
          data-testid="chat-panel-start-page-more-launcher"
        >
          {moreLauncherContent}
        </div>
      ) : (
        <CreatorContentLayout
          placement="fill"
          contentDataTestId={
            activeView === "work-item"
              ? "chat-panel-start-page-work-item-content"
              : "chat-panel-start-page-session-content"
          }
        >
          {agentLauncherContent ? (
            <div
              className="h-full w-full"
              data-testid={
                activeView === "work-item"
                  ? "chat-panel-start-page-work-item-launcher"
                  : "chat-panel-start-page-session-launcher"
              }
            >
              {agentLauncherContent}
            </div>
          ) : null}
        </CreatorContentLayout>
      )}
    </div>
  );
}
