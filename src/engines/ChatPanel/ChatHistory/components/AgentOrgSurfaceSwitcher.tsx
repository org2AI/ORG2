import React, { memo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import { DropdownPanel } from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import { HeaderSectionSeparator } from "@src/components/HeaderSectionSeparator";
import { AgentOrgWriterBadge } from "@src/engines/ChatPanel/blocks/OrgTaskBadges";
import { useDropdownEngine } from "@src/hooks/dropdown";
import {
  ArrowDown01Icon,
  HierarchyCircle01Icon,
  HugeiconsIcon,
  Tick01Icon,
} from "@src/icons";
import { isAgentOrgMemberEmpty } from "@src/util/agentOrg/memberActivity";

export interface AgentOrgSurfaceSwitcherProps {
  currentMemberId?: string | null;
  currentMemberName?: string | null;
  members?: AgentOrgRunMemberView[];
  overviewAvailable: boolean;
  overviewOpen: boolean;
  setOverviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onMemberSelect?: (member: AgentOrgRunMemberView) => void;
  onRunViewRefresh?: () => Promise<void>;
  groupChatActive?: boolean;
  groupChatAvailable?: boolean;
  onGroupChatToggle?: (active: boolean) => void;
  onCloseSiblingMenu?: () => void;
  siblingMenuOpen?: boolean;
  showTrailingSeparator?: boolean;
}

const SELECT_CHEVRON_CLASS = "shrink-0 text-text-3 transition-transform";

const MEMBER_RUNTIME_STATUS_LABEL_KEYS: Record<string, string> = {
  idle: "planner.agentOrgMemberStatus.idle",
  running: "planner.agentOrgMemberStatus.running",
  waiting_for_user: "planner.agentOrgMemberStatus.waitingForUser",
  completed: "planner.agentOrgMemberStatus.completed",
  failed: "planner.agentOrgMemberStatus.failed",
  cancelled: "planner.agentOrgMemberStatus.cancelled",
  user_intervention: "planner.agentOrgMemberStatus.userIntervention",
};

function formatFallbackStatusLabel(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const AgentOrgSurfaceSwitcher: React.FC<AgentOrgSurfaceSwitcherProps> = memo(
  ({
    currentMemberId = null,
    currentMemberName = null,
    members = [],
    overviewAvailable,
    overviewOpen,
    setOverviewOpen,
    onMemberSelect,
    onRunViewRefresh,
    groupChatActive = false,
    groupChatAvailable = false,
    onGroupChatToggle,
    onCloseSiblingMenu,
    siblingMenuOpen = false,
    showTrailingSeparator = false,
  }) => {
    const { t } = useTranslation();
    const runtimeMembers = members.filter((member) => member.sessionRuntime);
    const switchableMembers = [
      ...runtimeMembers.filter((member) => member.isCoordinator),
      ...runtimeMembers.filter((member) => !member.isCoordinator),
    ];
    const hasGroupChatOption = groupChatAvailable && Boolean(onGroupChatToggle);
    const canSwitchSurface =
      (switchableMembers.length > 1 && Boolean(onMemberSelect)) ||
      hasGroupChatOption;
    const currentMember = currentMemberId
      ? members.find((member) => member.memberId === currentMemberId)
      : currentMemberName
        ? members.find((member) => member.name === currentMemberName)
        : undefined;
    const groupChatLabel = t("sessions:groupChat.triggerLabel");
    const currentSurfaceLabel = groupChatActive
      ? groupChatLabel
      : currentMember?.isCoordinator
        ? "Coordinator"
        : (currentMember?.name ?? currentMemberName ?? null);
    const overviewLabel = t("sessions:planner.agentOrgOverview.title");
    const {
      isOpen: isMemberSwitcherOpen,
      isPositioned: isMemberSwitcherPositioned,
      setIsOpen: setMemberSwitcherOpen,
      close: closeMemberSwitcher,
      triggerRef: memberSwitcherTriggerRef,
      panelRef: memberSwitcherPanelRef,
      panelPosition: memberSwitcherPanelPosition,
    } = useDropdownEngine<HTMLButtonElement>({
      disabled: !canSwitchSurface,
      gap: 4,
      placement: "bottom",
      align: "left",
    });
    const memberSwitcherMaxHeight = Math.min(
      DROPDOWN_PANEL.maxHeight,
      memberSwitcherPanelPosition.maxHeight
    );

    useEffect(() => {
      if (siblingMenuOpen) closeMemberSwitcher();
    }, [closeMemberSwitcher, siblingMenuOpen]);

    if (!overviewAvailable && !currentSurfaceLabel) return null;

    return (
      <div
        className="flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden"
        data-testid="agent-org-surface-switcher"
        data-agent-org-surface={groupChatActive ? "group-chat" : "member"}
      >
        {overviewAvailable && (
          <Button
            htmlType="button"
            variant="tertiary"
            size="small"
            data-testid="agent-org-overview-trigger"
            data-agent-org-overview-trigger="true"
            className="shrink-0 whitespace-nowrap"
            aria-label={overviewLabel}
            aria-pressed={overviewOpen}
            title={overviewLabel}
            onClick={() => {
              closeMemberSwitcher();
              onCloseSiblingMenu?.();
              setOverviewOpen((open) => !open);
            }}
            icon={
              <HugeiconsIcon
                icon={HierarchyCircle01Icon}
                data-icon="hierarchy-circle"
                size={DROPDOWN_ITEM.iconSize}
                strokeWidth={1.75}
              />
            }
          >
            {overviewLabel}
          </Button>
        )}

        {overviewAvailable && currentSurfaceLabel && <HeaderSectionSeparator />}

        {currentSurfaceLabel && (
          <>
            <Button
              ref={memberSwitcherTriggerRef}
              htmlType="button"
              variant="tertiary"
              size="small"
              data-testid="agent-org-member-switcher-trigger"
              className="max-w-full min-w-0 disabled:cursor-default"
              disabled={!canSwitchSurface}
              aria-haspopup="menu"
              aria-expanded={isMemberSwitcherOpen}
              aria-pressed={isMemberSwitcherOpen}
              onClick={() => {
                if (!canSwitchSurface) return;
                setOverviewOpen(false);
                onCloseSiblingMenu?.();
                if (!isMemberSwitcherOpen) void onRunViewRefresh?.();
                setMemberSwitcherOpen(!isMemberSwitcherOpen);
              }}
              iconPosition="right"
              icon={
                canSwitchSurface ? (
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    data-icon="chevron-down"
                    size={DROPDOWN_ITEM.iconSize}
                    className={`${SELECT_CHEVRON_CLASS} ${
                      isMemberSwitcherOpen ? "rotate-180" : ""
                    }`}
                  />
                ) : undefined
              }
            >
              <span className="truncate">{currentSurfaceLabel}</span>
            </Button>

            {isMemberSwitcherOpen &&
              isMemberSwitcherPositioned &&
              createPortal(
                <DropdownPanel
                  ref={memberSwitcherPanelRef}
                  role="menu"
                  aria-label={groupChatLabel}
                  className="flex min-w-48 flex-col"
                  animated={false}
                  maxHeight={memberSwitcherMaxHeight}
                  style={{
                    position: "fixed",
                    top: memberSwitcherPanelPosition.top,
                    left: memberSwitcherPanelPosition.left,
                  }}
                >
                  <div
                    className={`${DROPDOWN_CLASSES.optionsContainerOverlay} min-h-0 flex-1 cursor-default`}
                    style={{ maxHeight: memberSwitcherMaxHeight }}
                  >
                    {hasGroupChatOption && (
                      <>
                        <Button
                          layout="custom"
                          htmlType="button"
                          role="menuitem"
                          aria-current={groupChatActive ? "page" : undefined}
                          data-testid="agent-org-group-chat-toggle"
                          className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} ${
                            groupChatActive ? DROPDOWN_CLASSES.itemSelected : ""
                          }`}
                          onClick={() => {
                            if (!groupChatActive) onGroupChatToggle?.(true);
                            closeMemberSwitcher();
                          }}
                        >
                          <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
                            {groupChatActive && (
                              <HugeiconsIcon
                                icon={Tick01Icon}
                                data-icon="check"
                                size={12}
                              />
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-left">
                            {groupChatLabel}
                          </span>
                        </Button>
                        <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
                      </>
                    )}

                    {switchableMembers.map((member) => {
                      const isCurrent =
                        !groupChatActive &&
                        (currentMemberId
                          ? member.memberId === currentMemberId
                          : member.name === currentMemberName);
                      const runtimeStatus = member.sessionRuntime?.status ?? "";
                      const memberLabel = member.isCoordinator
                        ? "Coordinator"
                        : member.name;
                      const hasNoTasksAndNoInbox =
                        !member.isCoordinator && isAgentOrgMemberEmpty(member);
                      const runtimeStatusLabelKey =
                        MEMBER_RUNTIME_STATUS_LABEL_KEYS[runtimeStatus];
                      const runtimeStatusLabel = member.activity
                        ? t(
                            `sessions:planner.agentOrgIntervention.activity.${member.activity.kind}`,
                            { count: member.queuedUserDirectedCount }
                          )
                        : hasNoTasksAndNoInbox
                          ? t("sessions:planner.agentOrgMemberStatus.noTasks")
                          : runtimeStatus
                            ? runtimeStatusLabelKey
                              ? t(`sessions:${runtimeStatusLabelKey}`)
                              : formatFallbackStatusLabel(runtimeStatus)
                            : "";

                      return (
                        <Button
                          key={member.memberId}
                          layout="custom"
                          htmlType="button"
                          role="menuitem"
                          aria-current={isCurrent ? "page" : undefined}
                          data-testid={`agent-org-member-switcher-option-${member.memberId}`}
                          className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} ${
                            isCurrent ? DROPDOWN_CLASSES.itemSelected : ""
                          }`}
                          onClick={() => {
                            if (groupChatActive) onGroupChatToggle?.(false);
                            onMemberSelect?.(member);
                            closeMemberSwitcher();
                          }}
                        >
                          <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
                            {isCurrent && (
                              <HugeiconsIcon
                                icon={Tick01Icon}
                                data-icon="check"
                                size={12}
                              />
                            )}
                          </span>
                          <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-left">
                            <span className="truncate">{memberLabel}</span>
                            {member.writerCapable && !member.isCoordinator && (
                              <AgentOrgWriterBadge>
                                {t(
                                  "sessions:planner.agentOrgIntervention.writerBadge"
                                )}
                              </AgentOrgWriterBadge>
                            )}
                          </span>
                          {runtimeStatusLabel && (
                            <span className="shrink-0 text-[11px] text-text-3">
                              {runtimeStatusLabel}
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </DropdownPanel>,
                document.body
              )}

            {showTrailingSeparator && <HeaderSectionSeparator />}
          </>
        )}
      </div>
    );
  }
);

AgentOrgSurfaceSwitcher.displayName = "AgentOrgSurfaceSwitcher";

export default AgentOrgSurfaceSwitcher;
