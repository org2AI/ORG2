/**
 * Public Chat Panel tab API.
 *
 * Command consumers use this boundary for opening, closing and navigating tabs.
 * Model, factory and state readers should import their owning modules directly;
 * atom identity comes from the single definition in each owner, not from this
 * forwarding module.
 */
export {
  clearChatPanelTabCliCommandAtom,
  closeAndDestroyChatPanelTabAtom,
  closeChatPanelTabAtom,
  closeOrganizationChatPanelTabAtom,
  closeOtherChatPanelTabsAtom,
  closeOtherThanActiveChatPanelTabsAtom,
  closeProjectOrgChatPanelTabsAtom,
  closeRevokedCloudChannelChatPanelTabsAtom,
  closeSessionChatPanelTabsAtom,
  closeWorkItemChatPanelTabAtom,
  nextChatPanelTabAtom,
  prevChatPanelTabAtom,
  reconcileDiscussionChannelTabsAtom,
  reorderChatPanelTabsAtom,
  setActiveWorkManagementSectionAtom,
  setChatPanelTabTitleAtom,
  type ReconcileDiscussionChannelTabsInput,
} from "./chatPanelTabLifecycleAtoms";
export {
  openChannelInChatPanelTabAtom,
  openGitHubIssueInChatPanelTabAtom,
  openGitHubPrInChatPanelTabAtom,
  openTeamInboxInChatPanelTabAtom,
} from "./chatPanelTabOpen/integrations";
export {
  addChatPanelTerminalTabAtom,
  openRuntimeInChatPanelTabAtom,
  openOrFocusSessionInChatPanelTabAtom,
  openOrReplaceSessionInChatPanelTabAtom,
  openRunGroupInChatPanelTabAtom,
  openSessionInNewChatTabAtom,
} from "./chatPanelTabOpen/session";
export {
  openCreateTargetInChatPanelStartPageAtom,
  openOrFocusChatPanelStartPageTabAtom,
} from "./chatPanelTabOpen/startPage";
export {
  openOrganizationInChatPanelTabAtom,
  openWorkManagementChatPanelTabAtom,
  openProjectInChatPanelTabAtom,
  openWorkItemInChatPanelTabAtom,
} from "./chatPanelTabOpen/workManagement";
export { createTerminalTab } from "./chatPanelTabFactories";
export {
  activateChatPanelTabAtom,
  syncActiveChatPanelTabStateAtom,
} from "./chatPanelTabPresentationAtoms";
export {
  activeChatPanelTabCanGoBackAtom,
  activeChatPanelTabCanGoForwardAtom,
  goBackChatPanelTabAtom,
  goForwardChatPanelTabAtom,
} from "./chatPanelTabNavigationAtoms";
export {
  type ChatPanelSelectedChannel,
  type ChatPanelTab,
  type ChatPanelTabType,
} from "./chatPanelTabsModel";
export {
  activeChatPanelTabAtom,
  activeChatPanelTabTypeAtom,
  activeWorkManagementSectionAtom,
  chatPanelTabCountAtom,
  chatPanelTabsAtom,
} from "./chatPanelTabsState";
export {
  canMoveChatPanelTabToWorkstation,
  canMoveWorkstationPrTabToChatPanel,
  moveChatPanelTabToWorkstationAtom,
  moveWorkstationPrTabToChatPanelAtom,
} from "./chatPanelTabPlacementAtom";
export {
  openRecentChatPanelTabAtom,
  recentChatPanelTabsAtom,
} from "./chatPanelRecentTabs";

export { openChatPanelCreateTargetAtom } from "./openChatPanelCreateTargetAtom";
