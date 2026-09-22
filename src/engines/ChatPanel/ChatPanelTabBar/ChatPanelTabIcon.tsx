import { useAtomValue } from "jotai";
import React from "react";

import { STORY_SYNC_ADAPTER } from "@src/api/http/integrations/syncConnections";
import AnyIcon from "@src/components/AnyIcon";
import IntegrationIcon from "@src/components/IntegrationIcon";
import {
  CircleDotIcon,
  DeliveryBox01Icon,
  GaugeIcon,
  GitPullRequestIcon,
  HashtagIcon,
  HugeiconsIcon,
  InformationCircleIcon,
  KanbanIcon,
  ListChecksIcon,
  ListTodoIcon,
  LockIcon,
  MessageAdd01Icon,
  MessageAdd02Icon,
  PencilEdit02Icon,
  Settings02Icon,
  SquareTerminalIcon,
} from "@src/icons";
import { isGitHubIssueStatus } from "@src/modules/ProjectManager/WorkItems/workItemIdentity";
import type { ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsModel";
import {
  CHAT_PANEL_CREATE_TARGET,
  chatPanelCreateTargetAtom,
} from "@src/store/ui/chatPanel/selectionAtoms";
import { WORK_MANAGEMENT_SECTION } from "@src/store/workstation";

import { SessionIdentityIconById } from "../components/SessionIdentityIcon";

/** Shared entity icon for expanded pills and supported collapsed headings. */
export function ChatPanelTabIcon({
  tab,
  isActive = false,
}: {
  tab: ChatPanelTab;
  isActive?: boolean;
}) {
  const createTarget = useAtomValue(chatPanelCreateTargetAtom);
  const iconColorClass = isActive ? "text-text-1" : "text-text-2";
  const isGitHubIssueTab =
    tab.type === "work-item" &&
    isGitHubIssueStatus(
      tab.workItem?.workItem.workItemStatus ?? tab.workItem?.workItem.status
    );

  const renderGlyph = (
    glyph: React.ComponentProps<typeof HugeiconsIcon>["icon"],
    name?: string
  ) => (
    <HugeiconsIcon
      icon={glyph}
      data-icon={name}
      size={16}
      strokeWidth={1.75}
      className={`shrink-0 ${iconColorClass}`}
      aria-hidden="true"
    />
  );

  let icon: React.ReactNode;
  if (tab.type === "terminal") {
    icon = renderGlyph(SquareTerminalIcon, "terminal-square");
  } else if (tab.type === "start-page") {
    if (createTarget === CHAT_PANEL_CREATE_TARGET.PROJECT) {
      icon = renderGlyph(DeliveryBox01Icon, "box");
    } else if (createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM) {
      icon = renderGlyph(PencilEdit02Icon, "square-pen");
    } else {
      icon = renderGlyph(MessageAdd02Icon, "message-add");
    }
  } else if (tab.type === "runtime") {
    icon = renderGlyph(GaugeIcon, "gauge");
  } else if (tab.type === "channel") {
    // Private cloud channels carry the same lock the sidebar row uses.
    const ChannelIcon =
      tab.channel?.scope === "cloud" && tab.channel.visibility === "private"
        ? LockIcon
        : HashtagIcon;
    icon = (
      <AnyIcon
        icon={ChannelIcon}
        size={16}
        strokeWidth={1.75}
        className={`shrink-0 ${iconColorClass}`}
      />
    );
  } else if (tab.type === "workspace") {
    icon = renderGlyph(InformationCircleIcon, "info");
  } else if (tab.type === "organization") {
    icon = renderGlyph(Settings02Icon, "settings-2");
  } else if (tab.type === "work-management") {
    const WorkManagementIcon =
      tab.managementSection === WORK_MANAGEMENT_SECTION.KANBAN
        ? KanbanIcon
        : ListTodoIcon;
    icon = renderGlyph(WorkManagementIcon);
  } else if (tab.type === "github-issue") {
    icon = renderGlyph(CircleDotIcon, "circle-dot");
  } else if (tab.type === "github-pr") {
    icon = renderGlyph(GitPullRequestIcon, "git-pull-request");
  } else if (isGitHubIssueTab) {
    icon = (
      <IntegrationIcon
        type={STORY_SYNC_ADAPTER.GITHUB}
        size={16}
        className={`shrink-0 ${iconColorClass}`}
      />
    );
  } else if (tab.type === "project") {
    icon = renderGlyph(DeliveryBox01Icon, "box");
  } else if (tab.type === "work-item") {
    icon = renderGlyph(ListChecksIcon, "list-checks");
  } else if (tab.type === "session" && tab.sessionId) {
    icon = (
      <SessionIdentityIconById
        sessionId={tab.sessionId}
        isSelected={isActive}
      />
    );
  } else {
    icon = renderGlyph(MessageAdd01Icon, "message-square-plus");
  }

  return icon;
}
