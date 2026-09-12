import React, { useCallback, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { SESSION_ROW_PRESENTATION } from "@src/components/SessionRowPresentation";
import type {
  SettingsNavigationGroup,
  SettingsNavigationItem,
  SettingsNavigationItemId,
} from "@src/config/settingsNavigation";
import { buildGlobalSettingsSearchGroups } from "@src/config/settingsSearch";
import { buildSettingsSetupActions } from "@src/config/settingsSetupActions";
import { useDropdownListNavigation } from "@src/hooks/dropdown/useDropdownListNavigation";
import { Cancel01Icon, HugeiconsIcon, Search01Icon } from "@src/icons";
import {
  type RenderedSettingsControl,
  collectRenderedSettingsControls,
} from "@src/modules/shared/layouts/blocks/SettingsSearchDropdown/settingsControlSearch";
import { createSettingsSearchIndex } from "@src/modules/shared/layouts/blocks/SettingsSearchDropdown/settingsSearchIndex";

import { SidebarList } from "../blocks";
import { SIDEBAR_STYLE } from "../config";
import {
  type SettingsControlSearchItem,
  type SettingsSidebarSearchItem,
  buildSettingsSidebarSearchPages,
} from "./settingsSidebarSearchPages";

interface SettingsSidebarSearchProps {
  navigationGroups: readonly SettingsNavigationGroup[];
  activeItemId: SettingsNavigationItemId;
  currentPath: string;
  onSelect: (item: SettingsNavigationItem) => void;
  onSelectControl: (item: SettingsControlSearchItem) => void;
  children: React.ReactNode;
}

const EMPTY_CONTROLS: readonly RenderedSettingsControl[] = [];

/** Inline page groups; typing never mounts settings pages or opens a portal. */
export default function SettingsSidebarSearch({
  navigationGroups,
  activeItemId,
  currentPath,
  onSelect,
  onSelectControl,
  children,
}: SettingsSidebarSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<{
    controls: readonly RenderedSettingsControl[];
    navigationGroups: readonly SettingsNavigationGroup[];
    translate: typeof t;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const isSearching = query.trim().length > 0;
  const renderedControls =
    snapshot?.navigationGroups === navigationGroups && snapshot.translate === t
      ? snapshot.controls
      : EMPTY_CONTROLS;
  const catalog = useMemo(
    () => buildGlobalSettingsSearchGroups(t, navigationGroups),
    [navigationGroups, t]
  );
  const searchIndex = useMemo(
    () =>
      createSettingsSearchIndex(
        buildSettingsSidebarSearchPages(
          navigationGroups,
          catalog,
          renderedControls,
          activeItemId,
          currentPath,
          buildSettingsSetupActions(t)
        )
      ),
    [navigationGroups, catalog, renderedControls, activeItemId, currentPath, t]
  );
  const pages = useMemo(
    () => (isSearching ? searchIndex(query) : []),
    [isSearching, query, searchIndex]
  );
  const visibleItems = useMemo(
    () =>
      pages.flatMap(({ page, items }) => [
        page,
        ...items.filter((item) => item.kind !== "navigation"),
      ]),
    [pages]
  );
  const itemIndexById = useMemo(
    () => new Map(visibleItems.map((item, index) => [item.id, index])),
    [visibleItems]
  );

  const clearSearch = useCallback(() => {
    setQuery("");
    setSnapshot(null);
  }, []);
  const selectItem = useCallback(
    (item: SettingsSidebarSearchItem) => {
      clearSearch();
      if (item.kind !== "control") onSelect(item.navigationItem);
      else onSelectControl(item);
    },
    [clearSearch, onSelect, onSelectControl]
  );
  const firstMatchIndex = itemIndexById.get(pages[0]?.items[0]?.id ?? "") ?? -1;
  const keyboard = useDropdownListNavigation({
    isOpen: isSearching,
    items: visibleItems,
    onSelect: selectItem,
    panelRef: listRef,
    disableGlobalListener: true,
    firstArrowDownSelectsInitial: true,
    initialSelectedIndex: firstMatchIndex,
  });
  // Page headings are navigable, but Enter should choose the actual match.
  // Reset before commit so query/locale changes cannot leave an invalid index.
  const [previousPages, setPreviousPages] = useState(pages);
  if (previousPages !== pages) {
    setPreviousPages(pages);
    keyboard.setSelectedIndex(firstMatchIndex);
  }

  const refreshSnapshot = () => {
    setSnapshot({
      controls: collectRenderedSettingsControls(),
      navigationGroups,
      translate: t,
    });
    keyboard.clearKeyboardNavigation();
  };
  const handleChange = (value: string) => {
    const nextSearching = value.trim().length > 0;
    if (nextSearching && !isSearching) refreshSnapshot();
    if (!nextSearching) setSnapshot(null);
    setQuery(value);
    keyboard.clearKeyboardNavigation();
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const activeItem = visibleItems[keyboard.selectedIndex];
  const optionId = (id: string) => `${listId}-option-${id}`;

  const renderItem = (item: SettingsSidebarSearchItem) => {
    const index = itemIndexById.get(item.id) ?? -1;
    const itemProps = keyboard.getItemProps(index);
    const isPage = item.kind === "navigation";
    return (
      <div
        key={item.id}
        id={optionId(item.id)}
        role="option"
        aria-selected={keyboard.selectedIndex === index}
        aria-label={item.label}
        data-dropdown-item-index={index}
        data-testid={`settings-navigation-search-result-${item.id}`}
        style={{ height: SIDEBAR_STYLE.rowHeight }}
        className={`${SESSION_ROW_PRESENTATION.row} cursor-pointer px-2 hover:bg-sidebar-selected ${
          keyboard.keyboardNavigated && keyboard.selectedIndex === index
            ? "bg-sidebar-selected"
            : ""
        } ${isPage ? "text-text-2" : "text-text-1"}`}
        onMouseEnter={itemProps.onMouseEnter}
        onClick={itemProps.onClick}
      >
        <div className={SESSION_ROW_PRESENTATION.content}>
          <span className={SESSION_ROW_PRESENTATION.leadingIcon} aria-hidden>
            {isPage && <AnyIcon icon={item.navigationItem.icon} size={14} />}
          </span>
          <span className={SESSION_ROW_PRESENTATION.title} title={item.label}>
            {item.label}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="shrink-0 px-3 pt-1 pb-2">
        <Input
          ref={inputRef}
          type="search"
          size="small"
          className="input-sidebar-search"
          value={query}
          onChange={handleChange}
          onFocus={() => {
            if (isSearching) refreshSnapshot();
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !isSearching) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              clearSearch();
            } else keyboard.handleKeyDown(event);
          }}
          placeholder={t("settings:searchPlaceholder")}
          aria-label={t("settings:searchPlaceholder")}
          prefix={
            <HugeiconsIcon
              icon={Search01Icon}
              size={14}
              className="text-text-3"
            />
          }
          suffix={
            query ? (
              <Button
                variant="tertiary"
                appearance="ghost"
                size="sidebar"
                iconOnly
                aria-label={t("common:tooltips.clearSearch")}
                onClick={() => {
                  inputRef.current?.focus();
                  clearSearch();
                }}
                icon={<HugeiconsIcon icon={Cancel01Icon} size={14} />}
              />
            ) : undefined
          }
          role="combobox"
          aria-controls={isSearching ? listId : undefined}
          aria-expanded={isSearching}
          aria-autocomplete="list"
          aria-activedescendant={
            activeItem ? optionId(activeItem.id) : undefined
          }
          data-testid="settings-navigation-search-input"
        />
      </div>
      <SidebarList scrollContainerRef={listRef}>
        {isSearching ? (
          <div
            id={listId}
            role="listbox"
            aria-label={t("settings:searchPlaceholder")}
            data-testid="settings-navigation-search-results"
          >
            {pages.length === 0 ? (
              <div
                className="px-2 py-3 text-sm text-text-3"
                role="status"
                aria-live="polite"
              >
                {t("settings:noSettingsFound", { query: query.trim() })}
              </div>
            ) : (
              pages.map(({ page, items }) => (
                <div
                  key={page.id}
                  role="group"
                  aria-labelledby={optionId(page.id)}
                  className="mb-4"
                  data-settings-search-page={page.id}
                >
                  {renderItem(page)}
                  {items
                    .filter((item) => item.kind !== "navigation")
                    .map(renderItem)}
                </div>
              ))
            )}
          </div>
        ) : (
          children
        )}
      </SidebarList>
    </>
  );
}
