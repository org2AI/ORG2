import type { CloudChannelVisibility } from "@src/contracts/channels";
import type {
  ChatPanelSelectedOrganization,
  ChatPanelSelectedProject,
  ChatPanelSelectedWorkItem,
  ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanel/selectionTypes";
import {
  WORK_MANAGEMENT_SECTION,
  type WorkManagementSection,
} from "@src/store/workstation/workstationTabBarAtoms";
import type {
  GitHubIssueDetailTabData,
  GitHubPrDetailTabData,
} from "@src/types/githubDetail";

export type ChatPanelTabType =
  | "session"
  | "terminal"
  | "start-page"
  | "runtime"
  | "work-management"
  | "workspace"
  | "organization"
  | "work-item"
  | "github-issue"
  | "github-pr"
  | "project"
  | "explore"
  | "channel"
  | "run-group";

/**
 * Payload for a "channel" tab, discriminated by scope. Local channels live in
 * `localChannelsAtom` (this machine, single user); cloud channels are org
 * rows from the `0014_org_channels.sql` control plane. Unlike the other tab
 * payloads this type lives here rather than in `selectionTypes.ts` — a channel
 * tab has no selection projection, so it never joins the surface state.
 */
export type ChatPanelSelectedChannel =
  | { scope: "local"; channelId: string; name: string }
  | {
      scope: "cloud";
      orgId: string;
      channelId: string;
      name: string;
      visibility: CloudChannelVisibility;
    };

export interface ChatPanelTab {
  id: string;
  type: ChatPanelTabType;
  /** Display label */
  title: string;
  /** Sidebar section owned by this Work Management tab. */
  managementSection?: WorkManagementSection;
  createdAt?: string;
  updatedAt?: string;
  /**
   * For "session" tabs: the linked ORGII session ID.
   * Legacy persisted empty tabs may still hydrate with null before migration.
   */
  sessionId?: string | null;
  /**
   * For "terminal" tabs: the terminal session ID in the shared terminal
   * atom store. Always prefixed "chatpanel-<uuid>" to isolate from
   * Workstation terminals.
   */
  terminalSessionId?: string;
  /**
   * For "terminal" tabs opened via the CLI launch bar: the bare binary command
   * to write to the PTY once the shell prompt is ready (e.g. "claude\n").
   * Written once after the PTY reports initialized; cleared afterwards.
   */
  cliCommand?: string;
  /**
   * For "workspace" tabs: the workspace whose overview / detail page this pill
   * owns. The overview surface renders straight from this payload.
   */
  workspace?: ChatPanelSelectedWorkspace;
  /**
   * For "organization" tabs: the cloud or local organization restored when
   * this shared management tab is activated.
   */
  organization?: ChatPanelSelectedOrganization;
  /**
   * For "work-item" tabs: the linked work item plus its project/org context.
   * Writable in place — the work-item panel edits/refreshes this payload.
   */
  workItem?: ChatPanelSelectedWorkItem;
  /** For GitHub issue tabs opened from a chat-pane Work Management parent. */
  githubIssue?: GitHubIssueDetailTabData;
  /** For GitHub PR tabs opened from a chat-pane Work Management parent. */
  githubPr?: GitHubPrDetailTabData;
  /**
   * For "project" tabs: the linked project plus its slug/org context. The
   * panel self-fetches the project's work items from `project.projectSlug`.
   */
  project?: ChatPanelSelectedProject;
  /**
   * For "channel" tabs: the local or cloud channel whose message surface this
   * pill owns. The surface renders straight from this payload.
   */
  channel?: ChatPanelSelectedChannel;
  /**
   * For "run-group" tabs: the multi-runner fan-out this pill owns. Only the id
   * is stored — the group itself lives in `runGroupsAtom`, and each run's live
   * state is read from the session store, so the tab payload cannot go stale.
   */
  runGroupId?: string;
}

export interface ChatPanelTabsState {
  tabs: ChatPanelTab[];
  activeTabId: string;
}

/** Fixed id of the shared cloud/local organization management tab. */
export const ORGANIZATION_TAB_ID = "chat-organization-management";

type ChatPanelTabStationAccess = "always" | "never";
export type ChatPanelWorkstationTransferKind =
  | "session"
  | "github-issue"
  | "github-pr";

/** Layout and transfer policy every chat-pane tab type must declare. */
export interface ChatPanelTabTypePolicy {
  /**
   * When the tab can share the workbench with a Station surface.
   * Conversation-oriented tabs can always remain docked beside the Station;
   * standalone management and detail surfaces always own the full workbench.
   */
  stationAccess: ChatPanelTabStationAccess;
  /** Lossless Chat Panel -> My Station mapping, or null when the tab cannot move. */
  workstationTransfer: ChatPanelWorkstationTransferKind | null;
  /**
   * Standalone tool surfaces (Work lists / Kanban, Runtime) keep the pane
   * header visible without any session controls or Launchpad search.
   */
  standaloneTool: boolean;
  /**
   * Whether the collapsed header shows the type icon beside the title.
   * Surfaces that publish their own entity header omit it rather than
   * adding a second identity icon.
   */
  collapsedHeadingIcon: boolean;
  /**
   * Whether the floating side-chat launcher earns its corner. The Launchpad
   * already is a composer and a session tab already shows its transcript
   * and composer, so both hide it; every other surface carries no chat of
   * its own.
   */
  sideChatLauncher: boolean;
}

/**
 * Intentionally exhaustive: a new tab type must make every layout decision
 * explicitly instead of silently inheriting an unsafe default.
 */
export const CHAT_PANEL_TAB_TYPE_POLICY: Record<
  ChatPanelTabType,
  ChatPanelTabTypePolicy
> = {
  session: {
    stationAccess: "always",
    workstationTransfer: "session",
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: false,
  },
  terminal: {
    stationAccess: "always",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
  "start-page": {
    stationAccess: "always",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: true,
    sideChatLauncher: false,
  },
  channel: {
    stationAccess: "always",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
  "run-group": {
    stationAccess: "always",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
  runtime: {
    stationAccess: "never",
    workstationTransfer: null,
    standaloneTool: true,
    collapsedHeadingIcon: true,
    sideChatLauncher: true,
  },
  "work-management": {
    stationAccess: "never",
    workstationTransfer: null,
    standaloneTool: true,
    collapsedHeadingIcon: true,
    sideChatLauncher: true,
  },
  workspace: {
    stationAccess: "never",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
  organization: {
    stationAccess: "never",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: true,
    sideChatLauncher: true,
  },
  "work-item": {
    stationAccess: "never",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
  "github-issue": {
    stationAccess: "never",
    workstationTransfer: "github-issue",
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
  "github-pr": {
    stationAccess: "never",
    workstationTransfer: "github-pr",
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
  project: {
    stationAccess: "never",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
  explore: {
    stationAccess: "never",
    workstationTransfer: null,
    standaloneTool: false,
    collapsedHeadingIcon: false,
    sideChatLauncher: true,
  },
};

function resolveChatPanelTabType(
  tabOrType: ChatPanelTab | ChatPanelTabType | null | undefined
): ChatPanelTabType | null {
  return typeof tabOrType === "string" ? tabOrType : (tabOrType?.type ?? null);
}

export function isChatPanelTabStationAvailable(
  tabOrType: ChatPanelTab | ChatPanelTabType | null | undefined
): boolean {
  const type = resolveChatPanelTabType(tabOrType);
  if (type === null) return true;
  return CHAT_PANEL_TAB_TYPE_POLICY[type].stationAccess === "always";
}

/** Whether the active tab is a standalone tool surface (Work lists, Runtime). */
export function isStandaloneChatPanelToolTab(
  tabOrType: ChatPanelTab | ChatPanelTabType | null | undefined
): boolean {
  const type = resolveChatPanelTabType(tabOrType);
  return type !== null && CHAT_PANEL_TAB_TYPE_POLICY[type].standaloneTool;
}

/** Resolve the layout without mutating the user's persisted maximize choice. */
export function resolveChatPanelMaximizedForLayout(
  userMaximized: boolean,
  tabOrType: ChatPanelTab | ChatPanelTabType | null | undefined
): boolean {
  return userMaximized || !isChatPanelTabStationAvailable(tabOrType);
}

export function getWorkManagementFallbackTitle(
  section: WorkManagementSection
): string {
  switch (section) {
    case WORK_MANAGEMENT_SECTION.PROJECTS:
      return "Projects";
    case WORK_MANAGEMENT_SECTION.INBOX:
      return "Inbox";
    case WORK_MANAGEMENT_SECTION.GITHUB_ISSUES:
      return "GitHub Issues";
    case WORK_MANAGEMENT_SECTION.GITHUB_PRS:
      return "GitHub PRs";
    case WORK_MANAGEMENT_SECTION.RUNS:
      return "Runs";
    case WORK_MANAGEMENT_SECTION.KANBAN:
      return "Kanban";
  }
}

export function isWorkManagementListSection(
  section: WorkManagementSection
): boolean {
  return section !== WORK_MANAGEMENT_SECTION.KANBAN;
}
