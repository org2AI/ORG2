// ============================================
// PanelHeader Component
// ============================================
import React from "react";

import Button from "@src/components/Button";
import { useShortcutKeys } from "@src/config/keyboard/useShortcutBindings";
import { HugeiconsIcon } from "@src/icons";
import {
  PANEL_HEADER_TOKENS,
  PanelHeader as SharedPanelHeader,
} from "@src/modules/shared/layouts/blocks";

import { ICON_CONFIG } from "../config";

// ============================================
// Type Definitions
// ============================================

export interface PanelHeaderProps {
  apiCallsCount: number;
  onClear: () => void;
  onClose: () => void;
}

// ============================================
// Component
// ============================================

const PanelHeader: React.FC<PanelHeaderProps> = ({
  apiCallsCount,
  onClear,
  onClose,
}) => {
  const shortcut = useShortcutKeys("toggle_api_panel");
  const headerTitle =
    apiCallsCount > 0 ? `API Calls ${apiCallsCount}` : "API Calls";

  const headerActions = (
    <>
      <Button
        {...PANEL_HEADER_TOKENS.actionButton}
        icon={
          <HugeiconsIcon
            icon={ICON_CONFIG.delete}
            size={PANEL_HEADER_TOKENS.buttonIconSize}
            strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth}
          />
        }
        onClick={onClear}
        disabled={apiCallsCount === 0}
        title="Clear all"
      />
      <Button
        {...PANEL_HEADER_TOKENS.actionButton}
        icon={
          <HugeiconsIcon
            icon={ICON_CONFIG.close}
            size={PANEL_HEADER_TOKENS.buttonIconSize}
            strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth}
          />
        }
        onClick={onClose}
        title={`Close (${shortcut})`}
      />
    </>
  );

  return (
    <SharedPanelHeader
      title={headerTitle}
      icon={ICON_CONFIG.api}
      subtitle={shortcut}
      actions={headerActions}
      className="rounded-tl-xl rounded-tr-xl"
    />
  );
};

export default PanelHeader;
