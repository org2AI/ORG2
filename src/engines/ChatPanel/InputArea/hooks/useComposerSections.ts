/**
 * useComposerSections
 *
 * Manages expand/collapse state for all ComposerStack sections:
 *
 * Primary cards (question, permission, modeswitch, plan) — start collapsed
 * as a primary-6 pill at the front of the pill row; the card only opens when
 * the user clicks its pill. New pending data never auto-expands a card.
 *
 * Secondary sections (processes, files) — pill-only; one card open at a
 * time. Queued messages are not a section: they always render as the tray
 * tucked behind the composer (see QueuedMessages).
 *
 * Shared between ChatView and PlaygroundChatPanel.
 */
import React, { useCallback, useMemo, useState } from "react";

import {
  ArrowLeftRightIcon,
  ClipboardListIcon,
  ComputerTerminal01Icon,
  FileDiffIcon,
  GitCommitHorizontalIcon,
  HelpCircleIcon,
  HugeiconsIcon,
  NotificationBubbleIcon,
} from "@src/icons";

import type { InlineSection } from "../components/CollapsedInlineRow";
import {
  type ComposerActiveSection,
  resolveComposerSectionForSessionSwitch,
} from "./composerSectionState";

export interface FileChangeStats {
  count: number;
  additions: number;
  deletions: number;
}

export interface GitArtifactStats {
  commitCount: number;
  pullRequestCount: number;
}

export interface UseComposerSectionsOptions {
  sessionId?: string | null;
  /** Whether the AskQuestionCard currently has pending data (controls pill visibility). */
  hasQuestion?: boolean;
  /** Whether the PermissionCard currently has pending data. */
  hasPermission?: boolean;
  /** Whether the ModeSwitchCard currently has pending data. */
  hasModeSwitch?: boolean;
  /** Whether the CreatePlanCard currently has a pending plan to review. */
  hasPlan?: boolean;
  /** Label shown on the collapsed plan pill. */
  planPillLabel?: string;
  /** Commit / pull request counts supplied by Rust Orgtrack for the current session. */
  gitArtifactStats?: GitArtifactStats;
  /** Opens the dedicated file-diff surface when the files/submissions pill is clicked. */
  onFilesExpand: () => void;
  /**
   * When provided, the files / git-artifacts pills open this dropdown menu
   * instead of invoking `onFilesExpand` directly. Surfaces without a menu
   * (e.g. the DevTools playground) keep the plain expand behavior.
   */
  filesMenu?: React.ReactNode;
  includeFileSections?: boolean;
}

const NOOP = () => {};

export function createFileInlineSection({
  fileChangeStats,
  onFilesExpand,
  filesMenu,
}: {
  fileChangeStats: FileChangeStats;
  onFilesExpand: () => void;
  filesMenu?: React.ReactNode;
}): InlineSection | null {
  if (fileChangeStats.count <= 0) return null;

  const diffStatNodes: React.ReactNode[] = [];
  if (fileChangeStats.additions > 0) {
    diffStatNodes.push(
      React.createElement(
        "span",
        { key: "additions", className: "font-normal text-green-500" },
        `+${fileChangeStats.additions}`
      )
    );
  }
  if (fileChangeStats.deletions > 0) {
    diffStatNodes.push(
      React.createElement(
        "span",
        { key: "deletions", className: "font-normal text-red-500" },
        `-${fileChangeStats.deletions}`
      )
    );
  }

  return {
    key: "files",
    icon: React.createElement(HugeiconsIcon, { icon: FileDiffIcon, size: 13 }),
    count: fileChangeStats.count,
    content: React.createElement(
      "span",
      { className: "inline-flex items-center gap-2" },
      React.createElement("span", null, fileChangeStats.count),
      diffStatNodes.length > 0
        ? React.createElement("span", {
            className:
              "inline-block h-0.5 w-0.5 shrink-0 rounded-full bg-text-4",
            "aria-hidden": true,
          })
        : null,
      ...diffStatNodes
    ),
    active: false,
    onExpand: filesMenu ? NOOP : onFilesExpand,
    droplist: filesMenu,
    testId: "composer-section-files",
  };
}

export function useComposerSections({
  sessionId,
  hasQuestion = false,
  hasPermission = false,
  hasModeSwitch = false,
  hasPlan = false,
  planPillLabel = "Plan",
  gitArtifactStats = { commitCount: 0, pullRequestCount: 0 },
  onFilesExpand,
  filesMenu,
  includeFileSections = true,
}: UseComposerSectionsOptions) {
  // Primary card collapsed states — collapsed until the user opens the pill.
  const [questionCollapsed, setQuestionCollapsed] = useState(true);
  const [permissionCollapsed, setPermissionCollapsed] = useState(true);
  const [modeSwitchCollapsed, setModeSwitchCollapsed] = useState(true);
  const [planCollapsed, setPlanCollapsed] = useState(true);

  // Secondary section — only one card open at a time, remembered per session.
  const [activeSection, setActiveSection] =
    useState<ComposerActiveSection>(null);
  const [activeSectionBySession, setActiveSectionBySession] = useState(
    () => new Map<string, ComposerActiveSection>()
  );

  // Counts reported by child components
  const [processVisibleCount, setProcessVisibleCount] = useState(0);
  const [fileChangeStats, setFileChangeStatsState] = useState<FileChangeStats>({
    count: 0,
    additions: 0,
    deletions: 0,
  });
  const setFileChangeStats = useCallback((next: FileChangeStats) => {
    setFileChangeStatsState((current) =>
      current.count === next.count &&
      current.additions === next.additions &&
      current.deletions === next.deletions
        ? current
        : next
    );
  }, []);

  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    const { activeSection: nextActiveSection, storedSectionForPrevious } =
      resolveComposerSectionForSessionSwitch({
        previousSessionId: prevSessionId,
        nextSessionId: sessionId,
        currentActiveSection: activeSection,
        previouslyStoredSection: sessionId
          ? activeSectionBySession.get(sessionId)
          : undefined,
      });
    if (prevSessionId && storedSectionForPrevious !== undefined) {
      setActiveSectionBySession((current) => {
        const next = new Map(current);
        next.set(prevSessionId, storedSectionForPrevious);
        return next;
      });
    }
    setPrevSessionId(sessionId);
    setActiveSection(nextActiveSection);
    setProcessVisibleCount(0);
    setFileChangeStats({ count: 0, additions: 0, deletions: 0 });
  }

  // New pending data (new question, new permission, etc.) starts collapsed
  // again, so a card the user opened for the previous item doesn't carry over.
  const [prevHasQuestion, setPrevHasQuestion] = useState(hasQuestion);
  if (hasQuestion !== prevHasQuestion) {
    setPrevHasQuestion(hasQuestion);
    if (hasQuestion) setQuestionCollapsed(true);
  }
  const [prevHasPermission, setPrevHasPermission] = useState(hasPermission);
  if (hasPermission !== prevHasPermission) {
    setPrevHasPermission(hasPermission);
    if (hasPermission) setPermissionCollapsed(true);
  }
  const [prevHasModeSwitch, setPrevHasModeSwitch] = useState(hasModeSwitch);
  if (hasModeSwitch !== prevHasModeSwitch) {
    setPrevHasModeSwitch(hasModeSwitch);
    if (hasModeSwitch) setModeSwitchCollapsed(true);
  }
  const [prevHasPlan, setPrevHasPlan] = useState(hasPlan);
  if (hasPlan !== prevHasPlan) {
    setPrevHasPlan(hasPlan);
    if (hasPlan) setPlanCollapsed(true);
  }

  const collapseQuestion = useCallback(() => setQuestionCollapsed(true), []);
  const expandQuestion = useCallback(() => setQuestionCollapsed(false), []);
  const collapsePermission = useCallback(
    () => setPermissionCollapsed(true),
    []
  );
  const expandPermission = useCallback(() => setPermissionCollapsed(false), []);
  const collapseModeSwitch = useCallback(
    () => setModeSwitchCollapsed(true),
    []
  );
  const expandModeSwitch = useCallback(() => setModeSwitchCollapsed(false), []);
  const collapsePlan = useCallback(() => setPlanCollapsed(true), []);
  const expandPlan = useCallback(() => setPlanCollapsed(false), []);

  const toggleProcess = useCallback(
    () => setActiveSection((prev) => (prev === "process" ? null : "process")),
    []
  );
  const processExpanded = activeSection === "process";

  const hasProcess = processVisibleCount > 0;
  const hasFiles = includeFileSections && fileChangeStats.count > 0;
  const gitArtifactCount =
    gitArtifactStats.commitCount + gitArtifactStats.pullRequestCount;
  const hasGitArtifacts = gitArtifactCount > 0;

  const hasAny =
    hasProcess ||
    hasFiles ||
    hasGitArtifacts ||
    (hasQuestion && questionCollapsed) ||
    (hasPermission && permissionCollapsed) ||
    (hasModeSwitch && modeSwitchCollapsed) ||
    (hasPlan && planCollapsed);

  const inlineSections = useMemo<InlineSection[]>(() => {
    const sections: InlineSection[] = [];

    // Primary pills — leading, primary-6 variant, icon + text label
    if (hasQuestion && questionCollapsed) {
      sections.push({
        key: "question",
        icon: React.createElement(HugeiconsIcon, {
          icon: HelpCircleIcon,
          size: 13,
        }),
        count: 0,
        label: "Question",
        active: false,
        variant: "primary",
        onExpand: expandQuestion,
      });
    }
    if (hasPermission && permissionCollapsed) {
      sections.push({
        key: "permission",
        icon: React.createElement(HugeiconsIcon, {
          icon: NotificationBubbleIcon,
          size: 13,
        }),
        count: 0,
        label: "Permission",
        active: false,
        variant: "primary",
        onExpand: expandPermission,
      });
    }
    if (hasModeSwitch && modeSwitchCollapsed) {
      sections.push({
        key: "modeswitch",
        icon: React.createElement(HugeiconsIcon, {
          icon: ArrowLeftRightIcon,
          size: 13,
        }),
        count: 0,
        label: "Mode Switch",
        active: false,
        variant: "primary",
        onExpand: expandModeSwitch,
      });
    }
    if (hasPlan && planCollapsed) {
      sections.push({
        key: "plan",
        icon: React.createElement(HugeiconsIcon, {
          icon: ClipboardListIcon,
          size: 13,
        }),
        count: 0,
        label: planPillLabel,
        active: false,
        variant: "primary",
        onExpand: expandPlan,
        testId: "composer-section-plan",
      });
    }

    // Secondary pills
    if (hasProcess) {
      sections.push({
        key: "process",
        icon: React.createElement(HugeiconsIcon, {
          icon: ComputerTerminal01Icon,
          size: 13,
        }),
        count: processVisibleCount,
        active: processExpanded,
        onExpand: toggleProcess,
        testId: "composer-section-process",
      });
    }
    if (includeFileSections) {
      const fileSection = createFileInlineSection({
        fileChangeStats,
        onFilesExpand,
        filesMenu,
      });
      if (fileSection) {
        sections.push(fileSection);
      }
    }
    if (hasGitArtifacts) {
      sections.push({
        key: "git-artifacts",
        icon: React.createElement(HugeiconsIcon, {
          icon: GitCommitHorizontalIcon,
          size: 13,
        }),
        count: gitArtifactCount,
        active: false,
        onExpand: filesMenu ? NOOP : onFilesExpand,
        droplist: filesMenu,
        testId: "composer-section-git-artifacts",
      });
    }

    return sections;
  }, [
    hasQuestion,
    questionCollapsed,
    hasPermission,
    permissionCollapsed,
    hasModeSwitch,
    modeSwitchCollapsed,
    hasPlan,
    planPillLabel,
    planCollapsed,
    expandQuestion,
    expandPermission,
    expandModeSwitch,
    expandPlan,
    hasProcess,
    hasGitArtifacts,
    processVisibleCount,
    fileChangeStats,
    gitArtifactCount,
    processExpanded,
    toggleProcess,
    onFilesExpand,
    filesMenu,
    includeFileSections,
  ]);

  return {
    // Primary card collapse state
    questionCollapsed,
    permissionCollapsed,
    modeSwitchCollapsed,
    planCollapsed,
    collapseQuestion,
    collapsePermission,
    collapseModeSwitch,
    collapsePlan,
    // Secondary section state
    processExpanded,
    toggleProcess,
    hasAny,
    inlineSections,
    setProcessVisibleCount,
    setFileChangeStats,
  };
}
