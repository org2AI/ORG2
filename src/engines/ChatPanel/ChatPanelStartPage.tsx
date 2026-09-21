import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import React, { useCallback, useState } from "react";

import SegmentedTextPill from "@src/components/SegmentedTextPill";
import type { SelectOption } from "@src/components/Select";
import { CREATOR_COMPOSER_POSITION } from "@src/config/sessionCreatorConfig";
import ImportSharedSessionDialog from "@src/features/Org2Cloud/ImportSharedSessionDialog";
import { LaunchpadActionCard } from "@src/features/SessionCreator/components/LaunchpadActionGrid";
import { creatorComposerPositionAtom } from "@src/store/session/creatorComposerPositionAtom";
import { creatorLaunchpadActionsVisibleAtom } from "@src/store/session/creatorLaunchpadActionsVisibleAtom";
import {
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelCreateTarget,
} from "@src/store/ui/chatPanel/selectionAtoms";

import { StartPageActiveLauncher } from "./StartPageActiveLauncher";
import { StartPageQuotaModal } from "./StartPageQuotaModal";
import { StartPageTabs } from "./StartPageTabs";
import { buildStartPageUtilityActions } from "./startPageUtilityActions";
import { type StartPageView, resolveStartPageView } from "./startPageView";

interface StartPageAgentLauncherOptions {
  createTarget:
    | typeof CHAT_PANEL_CREATE_TARGET.AGENT_SESSION
    | typeof CHAT_PANEL_CREATE_TARGET.WORK_ITEM;
  heroFooterSlot: React.ReactNode;
  launchpadActionsVisible: boolean;
  workItemModeControl: React.ReactNode;
}

interface ChatPanelStartPageProps {
  agentLauncher?: (options: StartPageAgentLauncherOptions) => React.ReactNode;
  className?: string;
  createTarget: ChatPanelCreateTarget;
  createTargetOptions: SelectOption[];
  moreLauncher?: (
    manualMiddleContent: React.ReactNode,
    creatorModeControl?: React.ReactNode
  ) => React.ReactNode;
  onAddApiKey: () => void;
  onCreateTarget: (target: string) => void;
  onProjectAgentModeChange: (enabled: boolean) => void;
  onWorkItemAgentModeChange: (enabled: boolean) => void;
  projectAgentMode: boolean;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
  workItemAgentMode: boolean;
  manualWorkItemLauncher?: (
    manualMiddleContent: React.ReactNode,
    creatorModeControl: React.ReactNode
  ) => React.ReactNode;
}

interface StartPageCreatorModeToggleProps {
  agentMode: boolean;
  dataTestId: string;
  onChange: (enabled: boolean) => void;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

function StartPageCreatorModeToggle({
  agentMode,
  dataTestId,
  onChange,
  t,
}: StartPageCreatorModeToggleProps): React.ReactNode {
  return (
    <SegmentedTextPill
      ariaLabel={`${t("common:terminology.agent")} / ${t(
        "common:tooltips.manual"
      )}`}
      dataTestId={dataTestId}
      value={agentMode ? "agent" : "manual"}
      options={[
        { value: "agent", label: t("common:terminology.agent") },
        { value: "manual", label: t("common:tooltips.manual") },
      ]}
      onChange={(value) => onChange(value === "agent")}
    />
  );
}

export function ChatPanelStartPage({
  agentLauncher,
  className,
  createTarget,
  createTargetOptions,
  moreLauncher,
  onAddApiKey,
  onCreateTarget,
  onProjectAgentModeChange,
  onWorkItemAgentModeChange,
  projectAgentMode,
  t,
  workItemAgentMode,
  manualWorkItemLauncher,
}: ChatPanelStartPageProps): React.ReactNode {
  const composerPosition = useAtomValue(creatorComposerPositionAtom);
  const launchpadActionsVisible = useAtomValue(
    creatorLaunchpadActionsVisibleAtom
  );
  const [isImportSessionDialogOpen, setIsImportSessionDialogOpen] =
    useState(false);
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const utilityActions = buildStartPageUtilityActions({
    onAddApiKey,
    setIsImportSessionDialogOpen,
    setIsQuotaModalOpen,
    t,
  });
  const activeView: StartPageView = resolveStartPageView(createTarget);
  const suggestionActions = launchpadActionsVisible
    ? utilityActions.map((action) => (
        <LaunchpadActionCard
          key={action.id}
          action={action}
          presentation={
            composerPosition === CREATOR_COMPOSER_POSITION.MIDDLE
              ? "pill"
              : "card"
          }
        />
      ))
    : null;
  const manualMiddleContent = (
    <div
      className="flex w-full flex-col items-center justify-center gap-4"
      data-testid="chat-panel-start-page-manual-middle-content"
    >
      <h1 className="text-center text-[18px] leading-relaxed font-normal tracking-tight text-text-1 sm:text-[20px]">
        {t(
          activeView === "work-item"
            ? "creator.manualPlanLaunchpadQuestion"
            : "creator.manualLaunchpadQuestion"
        )}
      </h1>
    </div>
  );
  const workItemModeControl = (
    <StartPageCreatorModeToggle
      agentMode={workItemAgentMode}
      dataTestId="chat-panel-start-page-work-item-mode-toggle"
      onChange={onWorkItemAgentModeChange}
      t={t}
    />
  );
  const projectModeControl = (
    <StartPageCreatorModeToggle
      agentMode={projectAgentMode}
      dataTestId="chat-panel-start-page-project-mode-toggle"
      onChange={onProjectAgentModeChange}
      t={t}
    />
  );
  const showManualWorkItem = activeView === "work-item" && !workItemAgentMode;
  const agentLauncherContent =
    activeView !== "more" && !showManualWorkItem
      ? agentLauncher?.({
          createTarget:
            activeView === "work-item"
              ? CHAT_PANEL_CREATE_TARGET.WORK_ITEM
              : CHAT_PANEL_CREATE_TARGET.AGENT_SESSION,
          heroFooterSlot: suggestionActions,
          launchpadActionsVisible,
          workItemModeControl,
        })
      : null;
  const manualWorkItemLauncherContent = showManualWorkItem
    ? manualWorkItemLauncher?.(manualMiddleContent, workItemModeControl)
    : null;
  const moreLauncherContent = moreLauncher?.(
    manualMiddleContent,
    createTarget === CHAT_PANEL_CREATE_TARGET.PROJECT
      ? projectModeControl
      : undefined
  );
  const handleViewChange = useCallback(
    (key: string) => {
      if (key === "session") {
        onCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        return;
      }
      if (key === "work-item") {
        onCreateTarget(CHAT_PANEL_CREATE_TARGET.WORK_ITEM);
        return;
      }
      if (
        key === "more" &&
        !createTargetOptions.some((option) => option.value === createTarget)
      ) {
        const fallbackTarget = createTargetOptions[0]?.value;
        if (typeof fallbackTarget === "string") {
          onCreateTarget(fallbackTarget);
        }
      }
    },
    [createTarget, createTargetOptions, onCreateTarget]
  );

  return (
    <div
      className={`flex w-full flex-col overflow-hidden ${className ?? ""}`}
      data-testid="chat-panel-start-page"
    >
      <StartPageTabs
        activeView={activeView}
        createTarget={createTarget}
        createTargetOptions={createTargetOptions}
        onCreateTarget={onCreateTarget}
        onViewChange={handleViewChange}
        t={t}
      />
      <StartPageActiveLauncher
        activeView={activeView}
        agentLauncherContent={agentLauncherContent}
        manualWorkItemLauncherContent={manualWorkItemLauncherContent}
        moreLauncherContent={moreLauncherContent}
        showManualWorkItem={showManualWorkItem}
      />
      {isImportSessionDialogOpen && (
        <ImportSharedSessionDialog
          visible
          onClose={() => setIsImportSessionDialogOpen(false)}
        />
      )}
      <StartPageQuotaModal
        visible={isQuotaModalOpen}
        onClose={() => setIsQuotaModalOpen(false)}
      />
    </div>
  );
}
