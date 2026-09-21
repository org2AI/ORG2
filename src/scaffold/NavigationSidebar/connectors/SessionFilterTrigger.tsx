import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { FilterMailIcon } from "@src/icons";

import HoverAnimatedIcon, {
  triggerIconAnimation,
} from "../components/HoverAnimatedIcon";

interface SessionFilterTriggerProps {
  isOpen: boolean;
  toggle: () => void;
  triggerRef: React.RefObject<HTMLDivElement | null>;
}

/** The filter icon button, with its tooltip, that anchors the filter menu. */
export function SessionFilterTrigger({
  isOpen,
  toggle,
  triggerRef,
}: SessionFilterTriggerProps): React.ReactElement {
  const { t } = useTranslation("navigation");

  return (
    <ToolbarTooltip
      label={t("sidebar.groupBy.title")}
      position="top"
      disabled={isOpen}
    >
      <div ref={triggerRef} className="inline-flex">
        <Button
          aria-label={t("sidebar.groupBy.title")}
          data-testid="sidebar-session-filter-button"
          size="small"
          variant="tertiary"
          className={`rounded-lg! ${
            isOpen
              ? "bg-sidebar-selected! text-text-1! hover:bg-sidebar-selected!"
              : "text-text-2! hover:bg-sidebar-selected! hover:text-text-1!"
          }`}
          onClick={toggle}
          onMouseEnter={(event) => triggerIconAnimation(event.currentTarget)}
          iconOnly
          icon={
            <HoverAnimatedIcon
              icon={FilterMailIcon}
              iconName="list-filter"
              size={16}
              strokeWidth={2}
              className={isOpen ? "text-text-1" : "text-text-2"}
            />
          }
        />
      </div>
    </ToolbarTooltip>
  );
}
