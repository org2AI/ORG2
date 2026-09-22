/**
 * NoTabsPlaceholder Component
 *
 * Shared empty state for all work station when no tabs are open.
 * Shows tool-specific icon and quick action shortcuts.
 *
 * Usage:
 *   <NoTabsPlaceholder icon="editor" actions={quickActions} />
 */
import React, { memo } from "react";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import { KeyboardShortcut } from "@src/components/KeyboardShortcut";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { EDITOR_TAB_CANVAS_BG_CLASS } from "@src/config/workstation/tokens";
import {
  BubbleChatIcon,
  ContentWritingIcon,
  DatabaseIcon,
  DeliveryBox01Icon,
  type IconSvgElement,
  InternetIcon,
  Layout01Icon,
  MessageMultiple01Icon,
  PowerServiceIcon,
  SmartPhone01Icon,
  WorkflowCircle05Icon,
} from "@src/icons";
import {
  SPOTLIGHT_CLASSES,
  SPOTLIGHT_TOKENS,
} from "@src/scaffold/GlobalSpotlight/constants";

import type { QuickAction } from "../QuickActionsPanel/types";

// ============================================
// Types
// ============================================

export type PlaceholderIcon =
  | "editor"
  | "source-control"
  | "browser"
  | "database"
  | "project"
  | "simulator"
  | "messages"
  | "chat"
  | "cargo"
  | "canvas";

interface NoTabsPlaceholderProps {
  /** Tool icon to display */
  icon: PlaceholderIcon;
  /** Optional line shown below the icon (e.g. simulator awaiting Agent) */
  caption?: string;
  /** Quick actions to display (omit for icon-only placeholder) */
  actions?: QuickAction[];
  /** Optional contextual content rendered below the shortcut actions */
  children?: React.ReactNode;
}

// ============================================
// Icon Config
// ============================================

const ICON_MAP: Record<PlaceholderIcon, IconSvgElement> = {
  editor: ContentWritingIcon,
  "source-control": WorkflowCircle05Icon,
  browser: InternetIcon,
  database: DatabaseIcon,
  project: DeliveryBox01Icon,
  simulator: PowerServiceIcon,
  messages: MessageMultiple01Icon,
  chat: BubbleChatIcon,
  cargo: SmartPhone01Icon,
  canvas: Layout01Icon,
};

// ============================================
// Action Item Component
// ============================================

interface ActionItemProps {
  action: QuickAction;
}

const ActionItem = memo<ActionItemProps>(({ action }) => {
  const handleClick = () => {
    if (!action.disabled && action.onAction) {
      action.onAction();
    }
  };

  return (
    <Button
      layout="custom"
      onClick={handleClick}
      disabled={action.disabled}
      className={`${SPOTLIGHT_CLASSES.itemRow} w-full text-left transition-colors ${
        action.disabled
          ? "cursor-not-allowed opacity-50"
          : `${SURFACE_TOKENS.hover} active:bg-fill-3`
      }`}
      style={{ height: SPOTLIGHT_TOKENS.itemHeight }}
    >
      <span
        className={`min-w-0 flex-1 truncate text-[14px] font-medium ${
          action.disabled ? "text-text-4" : "text-text-3"
        }`}
      >
        {action.label}
      </span>
      {action.shortcut && (
        <KeyboardShortcut shortcut={action.shortcut} rendering="original" />
      )}
    </Button>
  );
});

ActionItem.displayName = "ActionItem";

// ============================================
// Icon Component
// ============================================

interface ToolIconProps {
  icon: PlaceholderIcon;
}

const ToolIcon = memo<ToolIconProps>(({ icon }) => {
  return (
    <div className="flex justify-center pb-4">
      <div className="flex h-[100px] w-[100px] items-center justify-center">
        <AnyIcon
          icon={ICON_MAP[icon]}
          size={72}
          strokeWidth={1.25}
          className="text-text-1 opacity-30"
        />
      </div>
    </div>
  );
});

ToolIcon.displayName = "ToolIcon";

// ============================================
// Main Component
// ============================================

export const NoTabsPlaceholder: React.FC<NoTabsPlaceholderProps> = memo(
  ({ icon, caption, actions, children }) => {
    return (
      <div
        className={`flex h-full w-full items-center justify-center ${EDITOR_TAB_CANVAS_BG_CLASS}`}
      >
        <div className="w-[340px]">
          {/* Tool Icon */}
          <ToolIcon icon={icon} />

          {caption ? (
            <p className="mb-4 px-1 text-center text-[13px] leading-snug text-text-3">
              {caption}
            </p>
          ) : null}

          {/* Actions list */}
          {actions && actions.length > 0 && (
            <div
              className="flex flex-col"
              style={{ gap: SPOTLIGHT_TOKENS.itemGap }}
            >
              {actions.map((action) => (
                <ActionItem key={action.id} action={action} />
              ))}
            </div>
          )}

          {children}
        </div>
      </div>
    );
  }
);

NoTabsPlaceholder.displayName = "NoTabsPlaceholder";

export default NoTabsPlaceholder;
