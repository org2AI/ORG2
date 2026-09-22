import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import {
  Clock01Icon,
  FolderClosedIcon,
  HugeiconsIcon,
  ListIcon,
  MoreHorizontalIcon,
} from "@src/icons";

import { useMobileRemotePlatform } from "../platform";
import type { SessionGroupBy } from "./sessionGrouping";
import "./sessionViewMenu.scss";

export interface SessionViewMenuProps {
  value: SessionGroupBy;
  onChange: (value: SessionGroupBy) => void;
}

export function SessionViewMenu({ value, onChange }: SessionViewMenuProps) {
  const { t } = useTranslation("mobileRemote");
  const [open, setOpen] = useState(false);
  const { runtime } = useMobileRemotePlatform();
  const popupContainer = runtime.portalContainer?.();

  return (
    <Dropdown
      trigger="click"
      position="bottom-end"
      getPopupContainer={
        popupContainer ? () => popupContainer as HTMLElement : undefined
      }
      avoidViewportOverflow
      popupVisible={open}
      onVisibleChange={setOpen}
      value={value}
      className={`mobile-session-view-menu ${DROPDOWN_PANEL.menuMinWidthClass}`}
      dropdownRender={(menu) => (
        <div
          className="mobile-session-view-menu__content"
          data-testid="mobile-session-view-menu-panel"
        >
          <div className={DROPDOWN_CLASSES.sectionLabel}>
            <span className="whitespace-nowrap">{t("sessions.groupBy")}</span>
          </div>
          {menu}
        </div>
      )}
      options={[
        {
          label: t("sessions.groupNone"),
          value: "none",
          icon: (
            <HugeiconsIcon
              icon={ListIcon}
              size={DROPDOWN_ITEM.iconSize}
              aria-hidden="true"
            />
          ),
          dataTestId: "mobile-group-none",
        },
        {
          label: t("sessions.groupTime"),
          value: "time",
          icon: (
            <HugeiconsIcon
              icon={Clock01Icon}
              size={DROPDOWN_ITEM.iconSize}
              aria-hidden="true"
            />
          ),
          dataTestId: "mobile-group-time",
        },
        {
          label: t("sessions.groupWorkspace"),
          value: "workspace",
          icon: (
            <HugeiconsIcon
              icon={FolderClosedIcon}
              size={DROPDOWN_ITEM.iconSize}
              aria-hidden="true"
            />
          ),
          dataTestId: "mobile-group-workspace",
        },
      ]}
      onSelect={(next) => {
        if (next === "none" || next === "time" || next === "workspace")
          onChange(next);
      }}
    >
      <Button
        variant="tertiary"
        shape="circle"
        iconOnly
        className="mobile-chrome-icon-button"
        style={{
          width: "var(--mobile-touch-size)",
          height: "var(--mobile-touch-size)",
        }}
        aria-label={t("sessions.viewOptions")}
        aria-haspopup="listbox"
        aria-expanded={open}
        icon={
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            size={22}
            aria-hidden="true"
          />
        }
      />
    </Dropdown>
  );
}
