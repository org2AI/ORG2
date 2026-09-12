/** Shared searchable dropdown for Settings pages and navigation destinations. */
import React, { useCallback, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import {
  DropdownItem,
  DropdownPanel,
  DropdownSearch,
} from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";

import { createSettingsSearchIndex } from "./settingsSearchIndex";

export interface SettingsSearchDropdownItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon: React.ComponentProps<typeof AnyIcon>["icon"];
  readonly groupId: string;
  readonly searchTerms?: readonly string[];
}

export interface SettingsSearchDropdownGroup<
  TItem extends SettingsSearchDropdownItem = SettingsSearchDropdownItem,
> {
  readonly id: string;
  readonly label: string | null;
  readonly items: readonly TItem[];
}

interface SettingsSearchDropdownTriggerProps {
  readonly isOpen: boolean;
  readonly listboxId: string;
  readonly onClick: () => void;
}

interface SettingsSearchDropdownProps<
  TItem extends SettingsSearchDropdownItem,
> {
  readonly groups: readonly SettingsSearchDropdownGroup<TItem>[];
  readonly activeItemId?: string;
  readonly onSelect: (item: TItem) => void;
  readonly align?: "left" | "right";
  readonly minWidth?: number;
  readonly renderTrigger: (
    props: SettingsSearchDropdownTriggerProps
  ) => React.ReactNode;
}

function SettingsSearchDropdown<TItem extends SettingsSearchDropdownItem>({
  groups,
  activeItemId,
  onSelect,
  renderTrigger,
  align = "left",
  minWidth = 240,
}: SettingsSearchDropdownProps<TItem>) {
  const { t: tSettings } = useTranslation("settings");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const listboxId = useId();

  const searchIndex = useMemo(
    () => createSettingsSearchIndex(groups),
    [groups]
  );
  const filteredGroups = useMemo(
    () => searchIndex(searchQuery),
    [searchIndex, searchQuery]
  );

  const visibleItems = useMemo(
    () => filteredGroups.flatMap((group) => group.items),
    [filteredGroups]
  );

  const handleOpenChange = useCallback((open: boolean) => {
    setSelectorOpen(open);
  }, []);

  const handleSelect = useCallback(
    (item: TItem) => {
      setSelectorOpen(false);
      setSearchQuery("");
      onSelect(item);
    },
    [onSelect]
  );

  const {
    isOpen,
    isPositioned,
    setIsOpen,
    toggle,
    triggerRef,
    panelRef,
    panelPosition,
    keyboard,
  } = useDropdownEngine<HTMLSpanElement, TItem>({
    open: selectorOpen,
    onOpenChange: handleOpenChange,
    gap: DROPDOWN_PANEL.triggerGapTight,
    placement: "bottom",
    align,
    listNavigation: {
      disableGlobalListener: true,
      items: visibleItems,
      onSelect: handleSelect,
    },
  });

  const itemIndexById = useMemo(
    () => new Map(visibleItems.map((item, index) => [item.id, index])),
    [visibleItems]
  );
  const highlightedItem = visibleItems[keyboard.selectedIndex];
  const activeDescendant = highlightedItem
    ? `${listboxId}-option-${highlightedItem.id}`
    : undefined;

  const handleTriggerClick = useCallback(() => {
    if (!isOpen) setSearchQuery("");
    toggle();
  }, [isOpen, toggle]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (!isOpen) setIsOpen(true);
      keyboard.setSelectedIndex(0);
    },
    [isOpen, keyboard, setIsOpen]
  );

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Home" ||
        event.key === "End" ||
        event.key === "Enter"
      ) {
        keyboard.handleKeyDown(event);
      }
    },
    [keyboard]
  );

  return (
    <>
      <span ref={triggerRef} className="inline-flex min-w-0">
        {renderTrigger({
          isOpen,
          listboxId,
          onClick: handleTriggerClick,
        })}
      </span>

      {isOpen &&
        isPositioned &&
        createPortal(
          <DropdownPanel
            ref={panelRef}
            className={`${DROPDOWN_WIDTHS.panelWidthClass} fixed flex flex-col p-0!`}
            maxHeight={panelPosition.maxHeight}
            onKeyDown={keyboard.handleKeyDown}
            data-testid="settings-navigation-search-panel"
            style={{
              top: panelPosition.top,
              bottom: panelPosition.bottom,
              left:
                panelPosition.right === undefined
                  ? panelPosition.left
                  : undefined,
              right: panelPosition.right,
              minWidth: Math.max(panelPosition.width, minWidth),
            }}
          >
            <DropdownSearch
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder={tSettings("searchPlaceholder")}
              role="combobox"
              aria-controls={listboxId}
              aria-expanded={isOpen}
              aria-autocomplete="list"
              aria-activedescendant={activeDescendant}
              autoFocus
              testId="settings-navigation-search-input"
            />
            <div
              id={listboxId}
              role="listbox"
              aria-label={tSettings("searchPlaceholder")}
              className={DROPDOWN_CLASSES.optionsContainerOverlay}
              style={{
                maxHeight: Math.min(360, panelPosition.maxHeight - 44),
              }}
            >
              {filteredGroups.length === 0 ? (
                <div
                  className={DROPDOWN_CLASSES.listMessage}
                  role="status"
                  aria-live="polite"
                >
                  {tSettings("noSettingsFound", { query: searchQuery.trim() })}
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <React.Fragment key={group.id}>
                    {group.label && (
                      <div
                        className={DROPDOWN_CLASSES.sectionLabel}
                        role="presentation"
                      >
                        {group.label}
                      </div>
                    )}
                    {group.items.map((item) => {
                      const itemIndex = itemIndexById.get(item.id) ?? -1;
                      const keyboardProps = keyboard.getItemProps(itemIndex);
                      const isActive =
                        activeItemId !== undefined && item.id === activeItemId;
                      return (
                        <DropdownItem
                          key={item.id}
                          id={`${listboxId}-option-${item.id}`}
                          dataDropdownItemIndex={itemIndex}
                          role="option"
                          selected={isActive}
                          highlighted={
                            keyboard.keyboardNavigated &&
                            keyboard.selectedIndex === itemIndex
                          }
                          icon={
                            <AnyIcon
                              icon={item.icon}
                              size={DROPDOWN_ITEM.iconSize}
                              className="shrink-0"
                            />
                          }
                          dataTestId={`settings-navigation-search-result-${item.id}`}
                          onMouseEnter={keyboardProps.onMouseEnter}
                          onClick={keyboardProps.onClick}
                        >
                          {item.label}
                        </DropdownItem>
                      );
                    })}
                  </React.Fragment>
                ))
              )}
            </div>
          </DropdownPanel>,
          document.body
        )}
    </>
  );
}

export default SettingsSearchDropdown;
