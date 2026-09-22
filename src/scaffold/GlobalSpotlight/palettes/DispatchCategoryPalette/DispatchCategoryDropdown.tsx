/**
 * DispatchCategoryDropdown
 *
 * Anchored, compact variant of `DispatchCategoryPalette`. Shares
 * data + option building with the Spotlight variant via
 * `useDispatchCategoryOptions`, so both surfaces render the same
 * agents in the same order.
 *
 * The active variant is selected by the `general.modelPickerStyle`
 * setting and dispatched from the caller (e.g. SessionCreator).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { formatModelAgentType } from "@src/assets/providers";
import AnyIcon from "@src/components/AnyIcon";
import DropdownSearch from "@src/components/Dropdown/DropdownSearch";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import ModelIcon from "@src/components/ModelIcon";
import Tooltip from "@src/components/Tooltip";
import {
  type UseDropdownListNavigationReturn,
  useDropdownEngine,
} from "@src/hooks/dropdown";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { useFilteredItems } from "@src/hooks/search";

import { PickerOptionRow } from "../../components/PickerOptionRow";
import { PickerDropdownShell } from "../../shell/PickerDropdownShell";
import type { SpotlightItem } from "../../types";
import type { DispatchCategoryPaletteProps } from "./types";
import {
  buildGroupedSpotlightItems,
  useDispatchCategoryOptions,
} from "./useDispatchCategoryOptions";

const LIST_MAX_HEIGHT = 360;
/** Lower bound when the trigger is very narrow (e.g. collapsed sidebar). */
const MIN_DROPDOWN_WIDTH = 320;

function getItemData(item: SpotlightItem): Record<string, unknown> {
  return (item.data as Record<string, unknown> | undefined) ?? {};
}

const AvailableKeyCount: React.FC<{ keys: KeyVaultAccount[] }> = ({ keys }) => {
  const { t } = useTranslation("common");
  const hasKeys = keys.length > 0;

  const keyList = hasKeys ? (
    <div className="flex min-w-[180px] flex-col gap-1 py-0.5">
      {keys.map((key) => (
        <div key={key.id} className="flex min-w-0 items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <ModelIcon agentType={key.modelType} size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate">{key.name}</span>
          <span className="shrink-0 text-[11px] text-text-3">
            {formatModelAgentType(key.modelType)}
          </span>
        </div>
      ))}
    </div>
  ) : (
    <span>{t("selectors.modelSelector.noCompatibleKeys")}</span>
  );

  return (
    <Tooltip
      content={keyList}
      position="right"
      mouseEnterDelay={150}
      framedPanel
      smartPlacement
    >
      <span
        className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-2 tabular-nums"
        aria-label={`${keys.length} ${t("labels.keys")}`}
      >
        {keys.length}
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            hasKeys ? "bg-success-6" : "bg-danger-6"
          }`}
        />
      </span>
    </Tooltip>
  );
};

interface DropdownRowProps {
  item: SpotlightItem;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

const DropdownRow: React.FC<DropdownRowProps> = ({ item, keyboardProps }) => {
  const data = item.data ?? {};
  const availableKeys = data.availableKeys as KeyVaultAccount[] | undefined;
  return (
    <PickerOptionRow
      label={item.label}
      description={item.desc}
      icon={<AnyIcon icon={item.icon} size={16} className="text-text-2" />}
      selected={data.isCurrentSelection === true}
      disabled={data.disabled === true}
      testId={data.testId}
      keyboardProps={keyboardProps}
      className="text-[13px]"
      trailing={
        <>
          {data.tagLabel && (
            <span className="text-[11px] text-text-3">{data.tagLabel}</span>
          )}
          {availableKeys ? (
            <AvailableKeyCount keys={availableKeys} />
          ) : (
            data.rightContent
          )}
        </>
      }
    />
  );
};

interface DispatchCategoryDropdownProps extends DispatchCategoryPaletteProps {
  /** Element the dropdown is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  placement?: "top" | "bottom";
}

export const DispatchCategoryDropdown: React.FC<
  DispatchCategoryDropdownProps
> = ({
  isOpen,
  onClose,
  onSelect,
  currentCategory = "cli_agent",
  currentAgentDefinitionId,
  currentAgentOrgId,
  currentCliAgentType,
  hideOrgs = false,
  hideCliAgents = false,
  allowedCliAgentTypes,
  cliOnly = false,
  includeHumanSession = false,
  anchorRef,
  placement = "bottom",
}) => {
  const { t: tCommon } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement>(null);

  const { allOptions, groups, optionToItem } = useDispatchCategoryOptions({
    isOpen,
    hideOrgs,
    hideCliAgents,
    allowedCliAgentTypes,
    cliOnly,
    includeHumanSession,
    currentCategory,
    currentAgentDefinitionId,
    currentAgentOrgId,
    currentCliAgentType,
    onSelect,
    onClose,
  });

  const [searchQuery, setSearchQuery] = useState("");

  const { filteredItems: filteredOptions } = useFilteredItems({
    items: allOptions,
    searchQuery,
    getSearchText: (option) => `${option.name} ${option.desc}`,
  });

  const isSearching = searchQuery.trim().length > 0;

  // Build a flat list of items + headers for rendering. When searching
  // we drop headers since the grouping no longer holds.
  const items = useMemo(
    (): SpotlightItem[] =>
      isSearching
        ? filteredOptions.map((option) => optionToItem(option))
        : buildGroupedSpotlightItems(groups, optionToItem),
    [isSearching, filteredOptions, groups, optionToItem]
  );

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setSearchQuery("");
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const handleSelect = useCallback((item: SpotlightItem) => {
    const data = getItemData(item);
    if (data.isHeader === true || data.disabled === true) return;
    item.action?.();
  }, []);

  const { isPositioned, panelRef, panelPosition, keyboard } = useDropdownEngine<
    HTMLElement,
    SpotlightItem
  >({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    anchorRef,
    placement,
    gap: DROPDOWN_PANEL.triggerGap,
    listNavigation: {
      items,
      onSelect: handleSelect,
      isItemSelectable: (item) => {
        const data = getItemData(item);
        return data.isHeader !== true && data.disabled !== true;
      },
      initialSelectedIndex: -1,
    },
  });

  if (!isOpen || !isPositioned) return null;

  return (
    <PickerDropdownShell
      ref={panelRef}
      role="menu"
      position={panelPosition}
      preferredWidth={Math.max(MIN_DROPDOWN_WIDTH, panelPosition.width)}
      align="center"
    >
      <DropdownSearch
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder={tCommon("filters.searchAgentOrOrg")}
      />

      <div
        className={DROPDOWN_CLASSES.optionsContainerOverlay}
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {items.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            {tCommon("selectors.modelSelector.noResults")}
          </div>
        ) : (
          items.map((item, index) => {
            const data = getItemData(item);
            if (data.isHeader === true) {
              return (
                <div key={item.id} className={DROPDOWN_CLASSES.sectionLabel}>
                  {item.label}
                </div>
              );
            }
            return (
              <DropdownRow
                key={item.id}
                item={item}
                keyboardProps={keyboard.getItemProps(index)}
              />
            );
          })
        )}
      </div>
    </PickerDropdownShell>
  );
};

DispatchCategoryDropdown.displayName = "DispatchCategoryDropdown";
