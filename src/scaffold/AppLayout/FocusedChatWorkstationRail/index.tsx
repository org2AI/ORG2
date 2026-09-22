import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  WORKSTATION_TRAIL_WIDTH,
  WorkstationTrailBody,
  WorkstationTrailHeader,
  WorkstationTrailSurface,
} from "@src/components/layout/blocks";
import {
  FOCUSED_CHAT_WORKSTATION_MINIMAP_HOST_CLASS,
  resolveFocusedChatWorkstationRailInsetStyle,
  resolveFocusedChatWorkstationRailTrackClass,
} from "@src/engines/ChatPanel/focusedChatWorkstationLayout";

import { WorkstationCollapsedDiffStats } from "./WorkstationCollapsedDiffStats";
import { WorkstationCollapsedRailItems } from "./WorkstationCollapsedRailItems";
import { WorkstationCompactMenu } from "./WorkstationCompactMenu";
import { WorkstationSections } from "./WorkstationSections";
import { WorkstationSourceImagePreview } from "./WorkstationSourceImagePreview";
import { WorkstationSourcesSubmenu } from "./WorkstationSourcesSubmenu";
import { WorkstationSubagentsSubmenu } from "./WorkstationSubagentsSubmenu";
import { WorkstationTrailHeaderActions } from "./WorkstationTrailHeaderActions";
import { WorkstationTrailTerminal } from "./WorkstationTrailTerminal";
import { getStoredRailCollapsed, persistRailCollapsed } from "./railStorage";
import { resolveTrailWidthVariables } from "./trailWidth";
import type { FocusedChatWorkstationRailProps } from "./types";
import { useTrailPanelDimensions } from "./useTrailPanelDimensions";
import { useWorkstationRailGitHub } from "./useWorkstationRailGitHub";
import { useWorkstationRailSections } from "./useWorkstationRailSections";
import { useWorkstationRailSources } from "./useWorkstationRailSources";
import { useWorkstationRailSubagents } from "./useWorkstationRailSubagents";
import { useWorkstationRailTabs } from "./useWorkstationRailTabs";
import { useWorkstationRailTrailTerminal } from "./useWorkstationRailTrailTerminal";
import { useWorkstationRailWorkspace } from "./useWorkstationRailWorkspace";

export type {
  FocusedChatRailIcon,
  FocusedChatRailSource,
  FocusedChatRailSubagent,
  FocusedChatSessionContext,
} from "./types";

export function FocusedChatWorkstationRail({
  compactMenuHost,
  conversationMinimapHostRef,
  sessionContext,
  sources,
  subagentIcon,
  subagents,
  topInset = 0,
}: FocusedChatWorkstationRailProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(getStoredRailCollapsed);
  const panelDimensions = useTrailPanelDimensions();

  const {
    handleTrailContextMenu,
    miniTerminalClaimedIds,
    miniTerminalCollapsed,
    miniTerminalVisible,
    showMiniTerminal,
    showTrailTerminal,
    toggleMiniTerminal,
  } = useWorkstationRailTrailTerminal({ collapsed });

  const { browserTab, openTabItems, openWorkstationHost, openWorkstationTab } =
    useWorkstationRailTabs({ miniTerminalClaimedIds, showMiniTerminal, t });

  const { activeBranchName, sessionItems, workspaceItems } =
    useWorkstationRailGitHub({ sessionContext, t });

  const {
    collapsedGroupKeys,
    collapsedWorkspaceItems,
    primaryWorkspaceTitle,
    toggleGroup,
    workspaceSections,
  } = useWorkstationRailWorkspace({
    activeBranchName,
    browserTab,
    openWorkstationHost,
    openWorkstationTab,
    t,
    workspaceItems,
  });

  const {
    closeSubagentsSubmenu,
    handleMenuVisibleChange: handleSubagentsMenuVisibleChange,
    openSubagentSession,
    subagentItems,
    subagentsSubmenuAnchor,
    subagentsSubmenuInsideRefs,
    subagentsSubmenuMaxHeight,
    subagentsSubmenuPanelRef,
    subagentsSubmenuWidth,
  } = useWorkstationRailSubagents({ setMenuOpen, subagentIcon, subagents, t });

  const {
    closeImagePreview,
    closeSourcesSubmenu,
    imagePreview,
    openSource,
    sourceItems,
    sourcesSubmenuAnchor,
    sourcesSubmenuMaxHeight,
    sourcesSubmenuPanelRef,
    sourcesSubmenuWidth,
  } = useWorkstationRailSources({ setMenuOpen, sources, t });

  // Both "load more" panels belong to the compact menu they open from.
  const compactMenuInsideRefs = useMemo(
    () => [...subagentsSubmenuInsideRefs, sourcesSubmenuPanelRef],
    [sourcesSubmenuPanelRef, subagentsSubmenuInsideRefs]
  );
  const handleMenuVisibleChange = useCallback(
    (visible: boolean) => {
      handleSubagentsMenuVisibleChange(visible);
      if (!visible) closeSourcesSubmenu();
    },
    [closeSourcesSubmenu, handleSubagentsMenuVisibleChange]
  );

  const environmentLabel = t("navigation:labels.sessionEnvironment");
  const {
    compactSections,
    wideHeaderSectionKey,
    wideHeaderTitle,
    wideSections,
  } = useWorkstationRailSections({
    environmentLabel,
    openTabItems,
    primaryWorkspaceTitle,
    sessionContext,
    sessionItems,
    sourceCount: sources.length,
    sourceItems,
    subagentCount: subagents.length,
    subagentItems,
    t,
    workspaceSections,
  });

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      persistRailCollapsed(next);
      return next;
    });
  };

  const compactMenu = compactMenuHost ? (
    <WorkstationCompactMenu
      additionalInsideRefs={compactMenuInsideRefs}
      collapseGroupLabel={t("common:actions.collapse")}
      collapsedGroupKeys={collapsedGroupKeys}
      expandGroupLabel={t("common:actions.expand")}
      host={compactMenuHost}
      label={environmentLabel}
      menuOpen={menuOpen}
      onRequestClose={() => setMenuOpen(false)}
      onToggleGroup={toggleGroup}
      onVisibleChange={handleMenuVisibleChange}
      sections={compactSections}
    />
  ) : null;

  return (
    <>
      {compactMenu}
      {/* Only the terminal can widen this column; the trail keeps its fixed width. */}
      <div
        data-workstation-pane-control
        data-workstation-trail-track
        className={`relative flex h-full shrink-0 flex-col items-start ${
          panelDimensions.isCornerResizing
            ? ""
            : "transition-[width] duration-200 ease-out motion-reduce:transition-none"
        } ${resolveFocusedChatWorkstationRailTrackClass(collapsed)}`}
        style={{
          ...resolveFocusedChatWorkstationRailInsetStyle(topInset),
          ...resolveTrailWidthVariables({
            collapsed,
            // A folded terminal fills the trail's width; only its expanded
            // body needs the wider column. Keep the panel mounted in both.
            terminalShown: showTrailTerminal && !miniTerminalCollapsed,
            terminalWidth: panelDimensions.terminalWidth,
          }),
        }}
      >
        {/* Cap the panel group so long content still leaves the minimap in
            the column. Each panel can shrink within the available height. */}
        <div
          data-workstation-submenu-bounds=""
          className="relative hidden max-h-full min-h-0 w-full flex-col @[1100px]/focusedchat:flex"
        >
          <WorkstationTrailSurface
            as="aside"
            aria-label={environmentLabel}
            onContextMenu={handleTrailContextMenu}
            // `min-h-0` unconditionally: inside the capped group the trail
            // has to be able to shrink past its content height, whether what
            // it would push out is the terminal or the minimap track.
            className={`group/workstation-trail ml-auto flex min-h-0 ${WORKSTATION_TRAIL_WIDTH.surfaceResponsiveClass}`}
          >
            <WorkstationTrailHeader
              title={wideHeaderTitle}
              titleSuffix={
                wideHeaderSectionKey === "workspace" &&
                collapsedGroupKeys.has("workspace") ? (
                  <WorkstationCollapsedDiffStats
                    item={workspaceSections[0].items[0]}
                  />
                ) : undefined
              }
              collapsed={collapsed}
              // With its own group folded, the next visible line is another
              // section title, so the gap below must match the section rhythm
              // instead of hugging rows that are not there.
              bodyGap={
                collapsedGroupKeys.has(wideHeaderSectionKey) ? "section" : "row"
              }
              onTitleToggle={() => toggleGroup(wideHeaderSectionKey)}
              titleToggleCollapsed={collapsedGroupKeys.has(
                wideHeaderSectionKey
              )}
              titleToggleLabels={{
                collapse: t("common:actions.collapse"),
                expand: t("common:actions.expand"),
              }}
              actions={
                <WorkstationTrailHeaderActions
                  collapsed={collapsed}
                  miniTerminalVisible={miniTerminalVisible}
                  onToggleCollapsed={toggleCollapsed}
                  onToggleMiniTerminal={toggleMiniTerminal}
                />
              }
            />
            {collapsed ? (
              <WorkstationCollapsedRailItems items={collapsedWorkspaceItems} />
            ) : (
              <WorkstationTrailBody>
                <WorkstationSections
                  collapseGroupLabel={t("common:actions.collapse")}
                  collapsedGroupKeys={collapsedGroupKeys}
                  expandGroupLabel={t("common:actions.expand")}
                  onToggleGroup={toggleGroup}
                  sections={wideSections}
                />
              </WorkstationTrailBody>
            )}
          </WorkstationTrailSurface>
          {showTrailTerminal ? (
            <WorkstationTrailTerminal
              width={panelDimensions.terminalWidth}
              height={panelDimensions.terminalHeight}
              onResize={panelDimensions.resizeTerminal}
              onResizeEnd={panelDimensions.commitTerminalSize}
              onResizingChange={panelDimensions.setIsCornerResizing}
            />
          ) : null}
        </div>
        <div
          ref={conversationMinimapHostRef}
          data-focused-chat-conversation-minimap-host
          className={FOCUSED_CHAT_WORKSTATION_MINIMAP_HOST_CLASS}
        />
      </div>
      {subagentsSubmenuAnchor ? (
        <WorkstationSubagentsSubmenu
          anchor={subagentsSubmenuAnchor}
          icon={subagentIcon}
          maxHeight={subagentsSubmenuMaxHeight}
          onClose={closeSubagentsSubmenu}
          onOpenSubagent={openSubagentSession}
          panelRef={subagentsSubmenuPanelRef}
          subagents={subagents}
          width={subagentsSubmenuWidth}
        />
      ) : null}
      {sourcesSubmenuAnchor ? (
        <WorkstationSourcesSubmenu
          anchor={sourcesSubmenuAnchor}
          maxHeight={sourcesSubmenuMaxHeight}
          onClose={closeSourcesSubmenu}
          onOpenSource={openSource}
          panelRef={sourcesSubmenuPanelRef}
          sources={sources}
          width={sourcesSubmenuWidth}
        />
      ) : null}
      {imagePreview ? (
        <WorkstationSourceImagePreview
          images={imagePreview.images}
          index={imagePreview.index}
          onClose={closeImagePreview}
        />
      ) : null}
    </>
  );
}
