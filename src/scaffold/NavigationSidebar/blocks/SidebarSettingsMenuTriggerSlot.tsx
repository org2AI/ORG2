import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { Settings01Icon } from "@src/icons";

import HoverAnimatedIcon, {
  triggerIconAnimation,
} from "../components/HoverAnimatedIcon";
import type { SidebarSettingsMenuButtonProps } from "./sidebarSettingsMenuTypes";

interface SidebarSettingsMenuTriggerSlotProps {
  renderTrigger: SidebarSettingsMenuButtonProps["renderTrigger"];
  isOpen: boolean;
  handleToggle: () => void;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  openSettingsShortcut: string;
}

/** The caller's custom trigger, or the compact gear button with its tooltip. */
export function SidebarSettingsMenuTriggerSlot({
  renderTrigger,
  isOpen,
  handleToggle,
  triggerRef,
  openSettingsShortcut,
}: SidebarSettingsMenuTriggerSlotProps): React.ReactElement {
  const { t } = useTranslation("navigation");
  const settingsButtonClassName = isOpen ? "text-text-1" : "text-text-2";

  return renderTrigger ? (
    <div ref={triggerRef} className="flex min-w-0 flex-1">
      {renderTrigger({ isOpen, onClick: handleToggle })}
    </div>
  ) : (
    <ToolbarTooltip
      label={t("sidebar.bottomBar.settings")}
      shortcut={openSettingsShortcut}
      position="top"
      disabled={isOpen}
    >
      <div ref={triggerRef} className="inline-flex">
        <Button
          variant="tertiary"
          size="small"
          iconOnly
          aria-label={t("sidebar.bottomBar.settings")}
          className={`${
            isOpen
              ? "bg-sidebar-selected! text-text-1!"
              : "hover:bg-sidebar-selected!"
          }`}
          onClick={handleToggle}
          onMouseEnter={(event) => triggerIconAnimation(event.currentTarget)}
          icon={
            <HoverAnimatedIcon
              icon={Settings01Icon}
              iconName="settings"
              size={16}
              strokeWidth={2}
              className={settingsButtonClassName}
            />
          }
        />
      </div>
    </ToolbarTooltip>
  );
}
