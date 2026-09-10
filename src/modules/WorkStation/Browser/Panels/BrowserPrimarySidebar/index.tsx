/**
 * BrowserPrimarySidebar Component
 *
 * Primary sidebar for Browser tool using PrimarySidebarLayout.
 * Provides collapsible Regular Browsing and Private Browsing sections.
 *
 * Shares structural components with other Workstation for consistency.
 */
import type { BrowserSession } from "@/src/engines/BrowserCore/types";
import {
  PrimarySidebarLayout,
  type PrimarySidebarTab,
} from "@/src/modules/WorkStation/shared";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import { Add01Icon, FilterIcon, HugeiconsIcon, InternetIcon } from "@src/icons";

import SessionsTab from "./tabs/SessionsTab";

// ============================================
// Types
// ============================================

interface BrowserPrimarySidebarProps {
  /** List of browser sessions */
  sessions: BrowserSession[];
  /** Currently active session ID */
  activeSessionId: string | null;
  /** Callback to set active session */
  onSelectSession: (sessionId: string) => void;
  /** Callback to create a new session */
  onNewSession: () => void;
  /** Callback to create a new private session */
  onNewPrivateSession?: () => void;
  /** Callback to close a session */
  onCloseSession: (sessionId: string) => void;
}

// The shared layout requires a callback even when its single tab is hidden.
const handleTabChange = () => {};

// ============================================
// Component
// ============================================

export const BrowserPrimarySidebar: React.FC<BrowserPrimarySidebarProps> = memo(
  ({
    sessions,
    activeSessionId,
    onSelectSession,
    onNewSession,
    onNewPrivateSession,
    onCloseSession,
  }) => {
    const { t } = useTranslation();

    const [showFilterRegularSessions, setShowFilterRegularSessions] =
      useState(false);
    const [showFilterPrivateSessions, setShowFilterPrivateSessions] =
      useState(false);

    const handleToggleFilterRegularSessions = useCallback(() => {
      setShowFilterRegularSessions((prev) => !prev);
    }, []);

    const handleToggleFilterPrivateSessions = useCallback(() => {
      setShowFilterPrivateSessions((prev) => !prev);
    }, []);

    // Split sessions into regular and private
    const { regularSessions, privateSessions } = useMemo(() => {
      const regular: BrowserSession[] = [];
      const priv: BrowserSession[] = [];

      for (const session of sessions) {
        if (session.incognito) {
          priv.push(session);
        } else {
          regular.push(session);
        }
      }

      return { regularSessions: regular, privateSessions: priv };
    }, [sessions]);

    // Section header actions for regular browsing
    const regularActions: SectionHeaderAction[] = useMemo(
      () => [
        {
          key: "filter-regular-sessions",
          icon: (
            <HugeiconsIcon
              icon={FilterIcon}
              data-icon="filter-icon"
              size={14}
              className={showFilterRegularSessions ? "text-primary-6" : ""}
            />
          ),
          tooltip: t("common:actions.filter"),
          onClick: handleToggleFilterRegularSessions,
        },
        {
          key: "new-session",
          icon: <HugeiconsIcon icon={Add01Icon} data-icon="plus" size={14} />,
          tooltip: t("common:controlTower.sidebar.newTab"),
          onClick: onNewSession,
        },
      ],
      [
        showFilterRegularSessions,
        handleToggleFilterRegularSessions,
        onNewSession,
        t,
      ]
    );

    // Section header actions for private browsing
    const privateActions: SectionHeaderAction[] = useMemo(
      () => [
        {
          key: "filter-private-sessions",
          icon: (
            <HugeiconsIcon
              icon={FilterIcon}
              data-icon="filter-icon"
              size={14}
              className={showFilterPrivateSessions ? "text-primary-6" : ""}
            />
          ),
          tooltip: t("common:actions.filter"),
          onClick: handleToggleFilterPrivateSessions,
        },
        {
          key: "new-private-session",
          icon: <HugeiconsIcon icon={Add01Icon} data-icon="plus" size={14} />,
          tooltip: t("common:controlTower.sidebar.newPrivateTab"),
          onClick: onNewPrivateSession || onNewSession,
        },
      ],
      [
        showFilterPrivateSessions,
        handleToggleFilterPrivateSessions,
        onNewPrivateSession,
        onNewSession,
        t,
      ]
    );

    const tabs: PrimarySidebarTab[] = useMemo(() => {
      const sessionsTab: PrimarySidebarTab = {
        key: "sessions",
        label: t("tabs.sessions"),
        icon: (
          <HugeiconsIcon
            icon={InternetIcon}
            data-icon="globe"
            size={16}
            strokeWidth={1.75}
          />
        ),
        sections: [
          {
            key: "regular-browsing",
            title: t("labels.regularBrowsing"),
            content: (
              <SessionsTab
                sessions={regularSessions}
                activeSessionId={activeSessionId}
                onSelectSession={onSelectSession}
                onCloseSession={onCloseSession}
                showFilter={showFilterRegularSessions}
              />
            ),
            defaultFlexGrow: 1,
            resizable: true,
            actions: regularActions,
          },
          {
            key: "private-browsing",
            title: t("labels.privateBrowsing"),
            icon: (
              <HugeiconsIcon
                icon={InternetIcon}
                data-icon="globe"
                size={14}
                strokeWidth={1.75}
              />
            ),
            content: (
              <SessionsTab
                sessions={privateSessions}
                activeSessionId={activeSessionId}
                onSelectSession={onSelectSession}
                onCloseSession={onCloseSession}
                showFilter={showFilterPrivateSessions}
              />
            ),
            defaultFlexGrow: 1,
            defaultCollapsed: true,
            resizable: true,
            actions: privateActions,
          },
        ],
      };

      return [sessionsTab];
    }, [
      t,
      regularSessions,
      privateSessions,
      activeSessionId,
      onSelectSession,
      onCloseSession,
      regularActions,
      privateActions,
      showFilterRegularSessions,
      showFilterPrivateSessions,
    ]);

    return (
      <PrimarySidebarLayout
        tabs={tabs}
        activeTab="sessions"
        onTabChange={handleTabChange}
        hideTabs
      />
    );
  }
);

BrowserPrimarySidebar.displayName = "BrowserPrimarySidebar";

export default BrowserPrimarySidebar;
