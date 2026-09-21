import React from "react";
import { useTranslation } from "react-i18next";

import StatusDot from "@src/components/StatusDot";
import TabPill from "@src/components/TabPill";
import { HugeiconsIcon, LaptopIcon } from "@src/icons";

import type { DesktopPresence } from "../connection/types";

export interface SessionDeviceTabItem {
  id: string;
  name: string;
  presence: DesktopPresence;
  disabled?: boolean;
}

export interface SessionDeviceTabsProps {
  items: readonly SessionDeviceTabItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

/** Selection and connection work belong to the provider, never to this strip. */
export function SessionDeviceTabs({
  items,
  currentId,
  onSelect,
  disabled = false,
}: SessionDeviceTabsProps) {
  const { t } = useTranslation("mobileRemote");

  if (items.length === 0) return null;

  return (
    <div
      className="mobile-session-device-tabs min-w-0 overflow-x-auto overscroll-x-contain py-1"
      role="group"
      aria-label={t("devices.pairedDesktops")}
    >
      {/* Keep each name intrinsic-width; the outer strip owns horizontal overflow. */}
      <TabPill
        className="mobile-session-device-tabs__list gap-2! [&_button]:min-h-11"
        variant="pill"
        appearance="muted"
        size="large"
        activeTone="neutral"
        fillWidth={false}
        activeTab={currentId ?? ""}
        tabs={items.map((item) => ({
          key: item.id,
          label: item.name,
          disabled: disabled || item.disabled,
          dataTestId: "mobile-session-device-tab",
          icon: (
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <StatusDot
                color={
                  item.presence === "online" ? "bg-success-6" : "bg-text-4"
                }
                size="sm"
                label={
                  <span className="sr-only">
                    {t(
                      item.presence === "online"
                        ? "devices.online"
                        : item.presence === "offline"
                          ? "devices.offline"
                          : "devices.presenceUnknown"
                    )}
                  </span>
                }
              />
              <HugeiconsIcon icon={LaptopIcon} size={18} aria-hidden="true" />
              {item.id === currentId ? (
                <span className="sr-only">{t("devices.currentDesktop")}</span>
              ) : null}
            </span>
          ),
        }))}
        onChange={(id) => {
          const item = items.find((candidate) => candidate.id === id);
          if (!disabled && item && !item.disabled && id !== currentId) {
            onSelect(id);
          }
        }}
      />
    </div>
  );
}

SessionDeviceTabs.displayName = "SessionDeviceTabs";
