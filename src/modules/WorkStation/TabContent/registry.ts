/**
 * Tab-type → renderer registry.
 *
 * Each entry lazy-imports a tiny wrapper file in `./renderers/`. The
 * wrapper is responsible for adapting `tab.data` into the underlying
 * view component's prop shape. The dispatcher
 * (`UnifiedTabContent.tsx`) is the only consumer of this map.
 *
 * This registry is exhaustive over `WorkStationTabType`; every supported
 * tab type has a renderer entry.
 */
import { lazy } from "react";

import type { WorkStationTabType } from "@src/store/workstation/tabs/types";

import type { RendererEntry, TabContentRegistry } from "./types";

// ============================================
// Editor-family renderers
// ============================================

const FileEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/file")),
};

const ExplorerEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/explorer")),
};

const DirectoryEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/directory")),
};

const GitDiffEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/gitDiff")),
};

const SourceControlEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/sourceControl")),
};

const GitLogEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/gitLog")),
};

const GitCommitDetailEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/gitCommitDetail")),
};

const GitStashDetailEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/gitStashDetail")),
};

const TerminalContentEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/terminalContent")),
};

const DomComponentPreviewEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/domComponentPreview")),
};

const TerminalEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/terminal")),
};

const SearchEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/search")),
};

const SearchSessionsEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/searchSessions")),
};

const UrlPreviewEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/urlPreview")),
};

const SubagentDetailEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/subagentDetail")),
};

const AgentConfigEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/agentConfig")),
};

const ChatSessionEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/chatSession")),
};

// ============================================
// Browser renderers
// ============================================

const BrowserSessionEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/browserSession")),
};

const DevtoolsEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/devtools")),
};

// ============================================
// Project Manager renderers
// ============================================

const ProjectDashboardEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectDashboard")),
};

const ProjectWorkItemsEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectWorkItems")),
};

const ProjectWorkitemsEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectWorkitemsCompat")),
};

const ProjectLinearProjectsEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectLinearProjects")),
};

const ProjectLinearWorkItemsEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectLinearWorkItems")),
};

const ProjectSettingsEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectSettings")),
};

const ProjectOrgEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectOrg")),
};

const ProjectOrgSettingsEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectOrgSettings")),
};

const ProjectGitSyncReviewEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/projectGitSyncReview")),
};

const WorkItemDetailEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/workItemDetail")),
};

// ============================================
// Canvas Preview renderer
// ============================================

const CanvasPreviewEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/canvasPreview")),
};

// ============================================
// GitHub Issue Detail renderer
// ============================================

const GitHubIssueDetailEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/githubIssueDetail")),
};

const GitHubPrDetailEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/githubPrDetail")),
};

const StartEntry: RendererEntry = {
  Component: lazy(() => import("./renderers/start")),
};

// ============================================
// Registry — exhaustive over WorkStationTabType
// ============================================

export const REGISTRY: TabContentRegistry = {
  // Code Editor
  file: FileEntry,
  directory: DirectoryEntry,
  explorer: ExplorerEntry,
  "git-diff": GitDiffEntry,
  "source-control": SourceControlEntry,
  "git-log": GitLogEntry,
  "git-commit-detail": GitCommitDetailEntry,
  "git-stash-detail": GitStashDetailEntry,
  "terminal-content": TerminalContentEntry,
  "dom-component-preview": DomComponentPreviewEntry,
  terminal: TerminalEntry,
  search: SearchEntry,
  "search-sessions": SearchSessionsEntry,
  "url-preview": UrlPreviewEntry,

  // Browser
  "browser-session": BrowserSessionEntry,
  devtools: DevtoolsEntry,

  // Project Manager
  "project-dashboard": ProjectDashboardEntry,
  "project-work-items": ProjectWorkItemsEntry,
  "project-linear-projects": ProjectLinearProjectsEntry,
  "project-linear-work-items": ProjectLinearWorkItemsEntry,
  "project-settings": ProjectSettingsEntry,
  "project-org": ProjectOrgEntry,
  "project-org-settings": ProjectOrgSettingsEntry,
  "project-git-sync-review": ProjectGitSyncReviewEntry,
  "project-workitems": ProjectWorkitemsEntry,
  "workItem-detail": WorkItemDetailEntry,
  "chat-session": ChatSessionEntry,

  // Subagent
  "subagent-detail": SubagentDetailEntry,

  // Agent Config (Agent Teams page → opens here)
  "agent-config": AgentConfigEntry,

  // Canvas Preview
  "canvas-preview": CanvasPreviewEntry,

  // GitHub Issue Detail
  "github-issue-detail": GitHubIssueDetailEntry,

  // GitHub PR Detail
  "github-pr-detail": GitHubPrDetailEntry,

  // Start page launcher
  start: StartEntry,
};

// Exhaustiveness check: any missing WorkStationTabType becomes a TS error.
const _exhaustive: Record<WorkStationTabType, RendererEntry> = REGISTRY;
void _exhaustive;
