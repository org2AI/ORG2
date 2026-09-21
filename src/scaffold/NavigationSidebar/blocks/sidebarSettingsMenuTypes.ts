import type React from "react";

interface SidebarSettingsMenuTriggerProps {
  isOpen: boolean;
  onClick: () => void;
}

export interface SidebarSettingsMenuButtonProps {
  /** Replaces the compact gear trigger while preserving this menu's behavior. */
  renderTrigger?: (props: SidebarSettingsMenuTriggerProps) => React.ReactNode;
  /** Adds a login action when the account trigger represents a signed-out user. */
  onSignIn?: () => void;
}
