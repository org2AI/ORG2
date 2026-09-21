import Button from "@src/components/Button";
import DisclosureChevron from "@src/components/DisclosureChevron";
import {
  WORKSTATION_TRAIL_COMPOSITE_BUTTON_CLASS,
  WORKSTATION_TRAIL_TITLE_BUTTON_CLASS,
} from "@src/components/layout/tokens/workstationTrailTokens";
/**
 * WorkstationSections — renders the rail's section list in both the wide
 * (trail) and compact (dropdown menu) presentations.
 */
import { WORKSTATION_TRAIL_CONTENT } from "@src/config/workstation/tokens";
import {
  FolderClosedIcon,
  FolderKanbanIcon,
  GitForkIcon,
  WorkflowCircle05Icon,
} from "@src/icons";

import { EnvironmentKindRow } from "./EnvironmentKindRow";
import { OwnerIdentityRow } from "./OwnerIdentityRow";
import { WorkspaceContextRow } from "./WorkspaceContextRow";
import { WorkstationCollapsedDiffStats } from "./WorkstationCollapsedDiffStats";
import { WorkstationItemRow } from "./WorkstationItemRow";
import type { WorkstationSectionsProps } from "./types";
import { hasFocusedChatSessionEnvironment } from "./useWorkstationRailSections";

export function WorkstationSections({
  collapseGroupLabel,
  collapsedGroupKeys,
  compact = false,
  expandGroupLabel,
  onRequestClose,
  onToggleGroup,
  sections,
}: WorkstationSectionsProps) {
  return (
    <div
      className={compact ? "space-y-2" : WORKSTATION_TRAIL_CONTENT.sectionList}
      role={compact ? "menu" : undefined}
    >
      {sections.map((section) => {
        // Every section folds behind its heading, in both presentations.
        const groupCollapsed = collapsedGroupKeys?.has(section.key) === true;

        // In the wide rail, the panel header is also the heading for the first
        // (local-environment) group. Do not leave an empty spacer for its
        // unlabelled section when that group is collapsed.
        if (groupCollapsed && !section.label) return null;

        const changesItem = section.items.find(
          (item) => item.key === "changes" || item.key.startsWith("changes:")
        );

        return (
          <section
            key={section.key}
            className={
              compact ? "space-y-0.5" : WORKSTATION_TRAIL_CONTENT.section
            }
          >
            {section.label &&
              (collapseGroupLabel && expandGroupLabel && onToggleGroup ? (
                // The whole heading row is the fold toggle, with an
                // always-visible chevron right after the label — matching the
                // panel header's own title toggle.
                <Button
                  variant="tertiary"
                  size="sidebar"
                  className={`${WORKSTATION_TRAIL_COMPOSITE_BUTTON_CLASS} ${WORKSTATION_TRAIL_TITLE_BUTTON_CLASS} group/section-toggle h-6! w-full bg-transparent p-0!`}
                  data-workstation-group-toggle={section.key}
                  aria-expanded={!groupCollapsed}
                  aria-label={
                    groupCollapsed ? expandGroupLabel : collapseGroupLabel
                  }
                  onClick={() => onToggleGroup(section.key)}
                >
                  <div
                    className={`${WORKSTATION_TRAIL_CONTENT.sectionLabelInline} transition-colors group-hover/section-toggle:text-text-2`}
                  >
                    {section.label}
                  </div>
                  <DisclosureChevron
                    expanded={!groupCollapsed}
                    aria-hidden
                    className="shrink-0 text-text-3 group-hover/section-toggle:text-text-2"
                    size={14}
                    strokeWidth={1.75}
                  />
                  {groupCollapsed && changesItem ? (
                    <WorkstationCollapsedDiffStats item={changesItem} />
                  ) : null}
                </Button>
              ) : (
                <div className="flex h-6 items-center">
                  <div className={WORKSTATION_TRAIL_CONTENT.sectionLabelInline}>
                    {section.label}
                  </div>
                </div>
              ))}
            {!groupCollapsed &&
              section.environment &&
              hasFocusedChatSessionEnvironment(section.environment) && (
                <>
                  {section.environment.owner && (
                    <OwnerIdentityRow
                      compact={compact}
                      owner={section.environment.owner}
                    />
                  )}
                  {section.environment.environmentKind && (
                    <EnvironmentKindRow
                      compact={compact}
                      kind={section.environment.environmentKind}
                    />
                  )}
                  {section.environment.repoName && (
                    <WorkspaceContextRow
                      compact={compact}
                      icon={FolderClosedIcon}
                      label={section.environment.repoName}
                    />
                  )}
                  {section.environment.branchName && (
                    <WorkspaceContextRow
                      compact={compact}
                      icon={WorkflowCircle05Icon}
                      label={section.environment.branchName}
                      active={section.environment.branchAction?.active}
                      chevron={Boolean(section.environment.branchAction)}
                      onClick={section.environment.branchAction?.onClick}
                      onRequestClose={onRequestClose}
                      title={section.environment.branchAction?.label}
                      ariaLabel={section.environment.branchAction?.label}
                    />
                  )}
                  {section.environment.agentHarness && (
                    <WorkspaceContextRow
                      compact={compact}
                      icon={section.environment.agentHarness.icon}
                      label={section.environment.agentHarness.label}
                      testId="session-environment-agent-harness"
                    />
                  )}
                  {section.environment.worktreeBranchName && (
                    <WorkspaceContextRow
                      compact={compact}
                      icon={GitForkIcon}
                      label={section.environment.worktreeBranchName}
                      title={section.environment.worktreePath}
                    />
                  )}
                  {section.environment.workItem && (
                    <WorkspaceContextRow
                      compact={compact}
                      icon={FolderKanbanIcon}
                      label={`${section.environment.workItem.label}${
                        section.environment.workItem.statusLabel
                          ? ` · ${section.environment.workItem.statusLabel}`
                          : ""
                      }`}
                      onClick={section.environment.workItem.onClick}
                      onRequestClose={onRequestClose}
                      testId="session-active-work-item-pill"
                    />
                  )}
                </>
              )}
            {!groupCollapsed && changesItem ? (
              <WorkstationItemRow
                key={changesItem.key}
                compact={compact}
                item={changesItem}
                onRequestClose={onRequestClose}
              />
            ) : null}
            {!groupCollapsed &&
              section.items
                .filter((item) => item !== changesItem)
                .map((item) => (
                  <WorkstationItemRow
                    key={item.key}
                    compact={compact}
                    item={item}
                    onRequestClose={onRequestClose}
                  />
                ))}
          </section>
        );
      })}
    </div>
  );
}
