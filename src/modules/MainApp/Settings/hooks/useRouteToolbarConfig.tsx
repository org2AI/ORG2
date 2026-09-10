/**
 * useRouteToolbarConfig Hook
 *
 * Derives per-route header action configuration synchronously from:
 * - Current pathname (via useLocation)
 * - Region notices and integrations toolbar registrations for supplementary actions
 * Integration add and refresh actions live in the corresponding table headers.
 */
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import {
  WIZARD_IDS,
  buildAgentOrgsPath,
  buildWizardPath,
  parseCoreSettingsItem,
  parseSettingsTopTab,
} from "@src/config/mainAppPaths";
import { ROUTES } from "@src/config/routes";
import { HierarchyCircle01Icon, UserAdd01Icon } from "@src/icons";
import { integrationsToolbarAtom } from "@src/store/ui/integrationsToolbarAtom";
import type {
  RouteToolbarButton,
  RouteToolbarConfig,
} from "@src/store/ui/routeToolbarAtom";

import { useSettingsRegionNoticeButton } from "./useSettingsRegionNoticeButton";

const SETTINGS_PREFIX = ROUTES.app.settings.path;

export function useRouteToolbarConfig(): RouteToolbarConfig | null {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation("integrations");

  const settingsRegionNoticeButton = useSettingsRegionNoticeButton();

  const openAgentAdd = useCallback(() => {
    const agentsPath = buildAgentOrgsPath({ tab: "agents" });
    navigate(buildWizardPath(agentsPath, WIZARD_IDS.AGENT_ADD));
  }, [navigate]);

  const openOrgAdd = useCallback(() => {
    const agentsPath = buildAgentOrgsPath({ tab: "agents" });
    navigate(buildWizardPath(agentsPath, WIZARD_IDS.ORG_ADD));
  }, [navigate]);

  const coreSettingsItem = useMemo(
    () => parseCoreSettingsItem(pathname),
    [pathname]
  );
  const integrationsToolbar = useAtomValue(integrationsToolbarAtom);
  return useMemo(() => {
    if (pathname.startsWith(SETTINGS_PREFIX)) {
      const topTab = parseSettingsTopTab(pathname);

      if (topTab === "agent-orgs") {
        return {
          extraButtons: settingsRegionNoticeButton
            ? [settingsRegionNoticeButton]
            : undefined,
          plusDropdownItems: [
            {
              id: "add-agent",
              label: t("toolbarPlusMenu.addAgent"),
              icon: UserAdd01Icon,
              onClick: openAgentAdd,
            },
            {
              id: "add-org",
              label: t("agentOrgs.addOrg"),
              icon: HierarchyCircle01Icon,
              onClick: openOrgAdd,
            },
          ],
        };
      }

      if (coreSettingsItem.category) {
        const extraButtons: RouteToolbarButton[] = [];

        if (settingsRegionNoticeButton) {
          extraButtons.push(settingsRegionNoticeButton);
        }

        extraButtons.push(...(integrationsToolbar.extraButtons ?? []));

        return {
          extraButtons: extraButtons.length > 0 ? extraButtons : undefined,
        };
      }

      const extraButtons: RouteToolbarButton[] = [];

      if (settingsRegionNoticeButton) {
        extraButtons.push(settingsRegionNoticeButton);
      }

      return {
        extraButtons: extraButtons.length > 0 ? extraButtons : undefined,
      };
    }

    return null;
  }, [
    pathname,
    settingsRegionNoticeButton,
    openAgentAdd,
    openOrgAdd,
    coreSettingsItem,
    integrationsToolbar,
    t,
  ]);
}
