/**
 * SettingsSidebar
 *
 * Sidebar for the Settings page. The first level shows app settings plus
 * integration categories. Agent Teams now opens a single table surface; its
 * Agents / Teams / CLIs switcher lives inside the page, not in a drill-down
 * sidebar level.
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import Button from "@src/components/Button";
import { ROUTES } from "@src/config/routes";
import {
  type SettingsNavigationGroup,
  type SettingsNavigationItem,
  type SettingsNavigationItemId,
  buildSettingsNavigationGroups,
  getActiveSettingsNavigationItemId,
} from "@src/config/settingsNavigation";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { useOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";
import { SIDEBAR_MEMORY_KIND, useSidebarMemoryEntry } from "@src/hooks/perf";
import { ArrowLeft01Icon, Settings01Icon } from "@src/icons";
import {
  revealRenderedSettingsControl,
  revealSettingsControlWhenRendered,
} from "@src/modules/shared/layouts/blocks/SettingsSearchDropdown/settingsControlSearch";
import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";
import { settingsReturnPathAtom } from "@src/store/ui/settingsNavigationAtom";

import SidebarBase from "../SidebarBase";
import { SidebarBottomBar, SidebarHeaderNavButton } from "../blocks";
import SidebarSettingsMenuButton from "../blocks/SidebarSettingsMenuButton";
import HoverAnimatedIcon, {
  triggerIconAnimation,
} from "../components/HoverAnimatedIcon";
import NavigationMenu from "../components/NavigationMenu";
import type { NavigationMenuItem } from "../components/NavigationMenu/config";
import SidebarAccountButton from "../connectors/SidebarAccountButton";
import SettingsSidebarSearch from "./SettingsSidebarSearch";
import type { SettingsControlSearchItem } from "./settingsSidebarSearchPages";

interface SettingsFooterBackButtonProps {
  label: string;
  onClick: () => void;
}

const SettingsFooterBackButton: React.FC<SettingsFooterBackButtonProps> = ({
  label,
  onClick,
}) => (
  <Button
    htmlType="button"
    variant="tertiary"
    size="small"
    iconOnly
    aria-label={label}
    className="bg-sidebar-selected! text-text-1! hover:bg-sidebar-selected!"
    onClick={onClick}
    onMouseEnter={(event) => triggerIconAnimation(event.currentTarget)}
    icon={
      <HoverAnimatedIcon
        icon={Settings01Icon}
        iconName="settings"
        size={16}
        strokeWidth={2}
        className="text-text-1"
      />
    }
  />
);

const SettingsFooterAccountMenu: React.FC = () => {
  const cloudAuth = useAtomValue(org2CloudAuthAtom);
  const handleSignIn = useOrg2CloudSignIn();
  const identity = cloudAuth
    ? (cloudAuth.profile?.displayName ??
      cloudAuth.profile?.primaryEmail ??
      cloudAuth.userId)
    : null;

  return (
    <SidebarSettingsMenuButton
      onSignIn={identity === null ? handleSignIn : undefined}
      renderTrigger={({ isOpen, onClick }) => (
        <SidebarAccountButton
          identity={identity}
          avatarUrl={cloudAuth?.profile?.avatarUrl}
          menuOpen={isOpen}
          onClick={onClick}
        />
      )}
    />
  );
};

const SettingsSidebar: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const settingsReturnPath = useAtomValue(settingsReturnPathAtom);
  const devModeEnabled = useAtomValue(devModeEnabledAtom);
  const pendingSearchTargetRef = React.useRef<SettingsControlSearchItem | null>(
    null
  );
  const stopWaitingForTargetRef = React.useRef<(() => void) | null>(null);

  const navigationGroups = useMemo(
    () => buildSettingsNavigationGroups(t, devModeEnabled),
    [devModeEnabled, t]
  );
  const activeItemId = useMemo(
    () => getActiveSettingsNavigationItemId(location.pathname),
    [location.pathname]
  );
  const handleBack = useCallback(() => {
    navigate(settingsReturnPath || ROUTES.workStation.base.path);
  }, [navigate, settingsReturnPath]);

  const handleSelectNavigationItem = useCallback(
    (item: SettingsNavigationItem) => {
      pendingSearchTargetRef.current = null;
      stopWaitingForTargetRef.current?.();
      navigate(item.path);
    },
    [navigate]
  );

  const revealSearchTarget = useCallback((item: SettingsControlSearchItem) => {
    stopWaitingForTargetRef.current?.();
    stopWaitingForTargetRef.current = revealSettingsControlWhenRendered({
      targetId: item.targetId,
      searchKey: item.searchKey,
      label: item.label,
    });
  }, []);

  const handleSelectSettingsControl = useCallback(
    (item: SettingsControlSearchItem) => {
      stopWaitingForTargetRef.current?.();
      if (location.pathname === item.path) {
        revealSearchTarget(item);
        return;
      }
      pendingSearchTargetRef.current = item;
      navigate(item.path);
    },
    [location.pathname, navigate, revealSearchTarget]
  );

  React.useEffect(() => {
    const pendingTarget = pendingSearchTargetRef.current;
    if (!pendingTarget || pendingTarget.path !== location.pathname) return;
    pendingSearchTargetRef.current = null;
    revealSearchTarget(pendingTarget);
  }, [location.pathname, revealSearchTarget]);

  React.useEffect(
    () => () => {
      stopWaitingForTargetRef.current?.();
    },
    []
  );
  const settingsReturnItem = useMemo(
    () => (
      <SidebarHeaderNavButton
        icon={ArrowLeft01Icon}
        label={t("navigation:labels.settings")}
        onClick={handleBack}
      />
    ),
    [handleBack, t]
  );

  return (
    <SidebarBase
      topBarFollowingContent={
        <div className="shrink-0 px-3">{settingsReturnItem}</div>
      }
    >
      <SettingsRootBody
        navigationGroups={navigationGroups}
        activeItemId={activeItemId}
        searchScopeKey={location.pathname}
        onSelect={handleSelectNavigationItem}
        onSelectControl={handleSelectSettingsControl}
      />
      <SidebarBottomBar
        leftContent={<SettingsFooterAccountMenu />}
        rightActions={
          <SettingsFooterBackButton
            label={t("navigation:sidebar.bottomBar.settings")}
            onClick={handleBack}
          />
        }
      />
    </SidebarBase>
  );
};

export default SettingsSidebar;

interface SettingsRootBodyProps {
  navigationGroups: readonly SettingsNavigationGroup[];
  activeItemId: SettingsNavigationItemId;
  searchScopeKey: string;
  onSelect: (item: SettingsNavigationItem) => void;
  onSelectControl?: (item: SettingsControlSearchItem) => void;
}

export const SettingsRootBody: React.FC<SettingsRootBodyProps> = ({
  navigationGroups,
  activeItemId,
  searchScopeKey,
  onSelect,
  onSelectControl,
}) => {
  const appGroup = navigationGroups[0];
  const toMenuItems = useCallback(
    (items: readonly SettingsNavigationItem[]): NavigationMenuItem[] =>
      items.map((item) => ({
        id: item.id,
        key: item.id,
        label: item.label,
        icon: item.icon,
        dataTestId: item.dataTestId,
        routePath: item.path,
      })),
    []
  );
  const appSectionItems = useMemo(
    () => toMenuItems(appGroup?.items ?? []),
    [appGroup, toMenuItems]
  );
  const namedSections = useMemo(
    () =>
      navigationGroups.slice(1).map((group) => ({
        ...group,
        items: toMenuItems(group.items),
      })),
    [navigationGroups, toMenuItems]
  );
  const itemById = useMemo(
    () =>
      new Map(
        navigationGroups
          .flatMap((group) => group.items)
          .map((item) => [item.id, item])
      ),
    [navigationGroups]
  );
  const handleSelectSearchItem = useCallback(
    (item: SettingsControlSearchItem) => {
      if (onSelectControl) {
        onSelectControl(item);
        return;
      }
      if (item.targetId) {
        requestAnimationFrame(() =>
          revealRenderedSettingsControl(item.targetId ?? "")
        );
      }
    },
    [onSelectControl]
  );

  const handleItemClick = useCallback(
    (key: string) => {
      const item = itemById.get(key as SettingsNavigationItem["id"]);
      if (item) onSelect(item);
    },
    [itemById, onSelect]
  );

  const selectedKeys = useMemo(() => [activeItemId], [activeItemId]);
  const integrationItemCount = namedSections.reduce(
    (sum, section) => sum + section.items.length,
    0
  );

  useSidebarMemoryEntry({
    kind: SIDEBAR_MEMORY_KIND.SETTINGS,
    label: "Settings root",
    items: appSectionItems.length + integrationItemCount,
    sections: namedSections.length + 1,
    source: { activeItemId, appSectionItems, namedSections },
  });

  return (
    <SettingsSidebarSearch
      key={searchScopeKey}
      navigationGroups={navigationGroups}
      activeItemId={activeItemId}
      currentPath={searchScopeKey}
      onSelect={onSelect}
      onSelectControl={handleSelectSearchItem}
    >
      <NavigationMenu
        items={appSectionItems}
        selectedKeys={selectedKeys}
        onMenuItemClick={handleItemClick}
      />
      {namedSections.map((section) => (
        <div key={section.id} className="mt-4">
          <div className="mb-1 px-2 text-[11px] font-medium tracking-wider text-text-1 uppercase">
            {section.label}
          </div>
          <NavigationMenu
            items={section.items}
            selectedKeys={selectedKeys}
            onMenuItemClick={handleItemClick}
          />
        </div>
      ))}
    </SettingsSidebarSearch>
  );
};
