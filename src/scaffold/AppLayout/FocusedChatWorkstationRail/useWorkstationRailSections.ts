/**
 * Section-order composition for the focused-chat workstation rail: the
 * ordered section list, its compact-menu projection, and the wide-trail
 * projection whose first section is hoisted into the header.
 */
import type { TFunction } from "i18next";
import { useMemo } from "react";

import { resolveFocusedChatWorkstationSectionOrder } from "@src/engines/ChatPanel/focusedChatWorkstationLayout";

import { FOCUSED_CHAT_RAIL_SECTIONS } from "./railSectionKeys";
import type {
  FocusedChatRailItem,
  FocusedChatRailSection,
  FocusedChatSessionContext,
} from "./types";

/**
 * Whether a section environment carries any identity worth rendering. Decides
 * both whether the session section exists and whether a section renders its
 * environment rows.
 */
export function hasFocusedChatSessionEnvironment(
  environment: FocusedChatSessionContext | undefined
): boolean {
  return Boolean(
    environment?.agentHarness ||
    environment?.repoName ||
    environment?.branchName ||
    environment?.worktreeBranchName ||
    environment?.workItem ||
    environment?.owner
  );
}

export function useWorkstationRailSections({
  environmentLabel,
  openTabItems,
  primaryWorkspaceTitle,
  sessionContext,
  sessionItems,
  sourceCount,
  sourceItems,
  subagentCount,
  subagentItems,
  t,
  workspaceSections,
}: {
  environmentLabel: string;
  openTabItems: FocusedChatRailItem[];
  primaryWorkspaceTitle: string;
  sessionContext: FocusedChatSessionContext | undefined;
  sessionItems: FocusedChatRailItem[];
  sourceCount: number;
  sourceItems: FocusedChatRailItem[];
  subagentCount: number;
  subagentItems: FocusedChatRailItem[];
  t: TFunction;
  workspaceSections: FocusedChatRailSection[];
}) {
  const hasSessionEnvironment =
    hasFocusedChatSessionEnvironment(sessionContext);
  const sections = useMemo<FocusedChatRailSection[]>(() => {
    return resolveFocusedChatWorkstationSectionOrder(
      openTabItems.length > 0,
      hasSessionEnvironment,
      subagentItems.length > 0,
      sessionContext?.environmentKind,
      sourceItems.length > 0
    ).flatMap((sectionKey): FocusedChatRailSection[] => {
      if (sectionKey === "workspace") return workspaceSections;
      return [
        {
          ...FOCUSED_CHAT_RAIL_SECTIONS[sectionKey],
          label:
            sectionKey === "session"
              ? t("navigation:labels.sessionEnvironment")
              : sectionKey === "subagents"
                ? t("common:git.rail.subagentsCount", {
                    count: subagentCount,
                  })
                : sectionKey === "sources"
                  ? t("common:git.rail.sourcesCount", { count: sourceCount })
                  : t("common:git.rail.openTabs"),
          items:
            sectionKey === "tabs"
              ? openTabItems
              : sectionKey === "subagents"
                ? subagentItems
                : sectionKey === "sources"
                  ? sourceItems
                  : sessionItems,
          environment: sectionKey === "session" ? sessionContext : undefined,
        },
      ];
    });
  }, [
    hasSessionEnvironment,
    openTabItems,
    sessionContext,
    sessionItems,
    sourceCount,
    sourceItems,
    subagentItems,
    subagentCount,
    t,
    workspaceSections,
  ]);

  const compactSections = useMemo<FocusedChatRailSection[]>(
    () =>
      sections.map((section) =>
        section.key === "workspace"
          ? { ...section, label: primaryWorkspaceTitle }
          : section
      ),
    [primaryWorkspaceTitle, sections]
  );
  const cloudSessionFirst =
    hasSessionEnvironment && sessionContext?.environmentKind === "cloud";
  const wideHeaderSectionKey = cloudSessionFirst ? "session" : "workspace";
  const wideHeaderTitle = cloudSessionFirst
    ? environmentLabel
    : primaryWorkspaceTitle;
  const wideSections = useMemo<FocusedChatRailSection[]>(
    () =>
      cloudSessionFirst
        ? sections.map((section) =>
            section.key === "session"
              ? { ...section, label: null }
              : section.key === "workspace"
                ? { ...section, label: primaryWorkspaceTitle }
                : section
          )
        : sections,
    [cloudSessionFirst, primaryWorkspaceTitle, sections]
  );

  return {
    compactSections,
    wideHeaderSectionKey,
    wideHeaderTitle,
    wideSections,
  };
}
