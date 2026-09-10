/**
 * DispatchCategoryPalette Component
 *
 * Unified agent palette that shows all dispatchable agents in one list:
 * - Rust-native agents (OS Agent, SDE Agent)
 * - Installed CLI agents (Cursor, Claude Code, Codex, etc.)
 * - User-defined custom agents
 *
 * Each agent row shows compatible credential badges on the right. Option
 * data, grouping, and row adaptation come from `useDispatchCategoryOptions`,
 * shared with the anchored `DispatchCategoryDropdown`; this component owns
 * the Spotlight chrome and the GUI/TUI launch-mode switch.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useFilteredItems } from "@src/hooks/search";
import { useSelector as useSelectorKernel } from "@src/scaffold/GlobalSpotlight/hooks/selectors/useSelector";
import { CLI_LAUNCH_MODE, type CliLaunchMode } from "@src/store/session";

import { ManageAgentsFooterAction } from "../../components";
import { useAccountFooterForHovered } from "../../hooks";
import { PaletteBody, ShellFooterAction, SpotlightShell } from "../../shell";
import type { PathSegment, SpotlightItem } from "../../types";
import { CliAgentListFilterSwitch } from "./CliAgentListFilterSwitch";
import type { DispatchCategoryPaletteProps } from "./types";
import {
  buildGroupedSpotlightItems,
  useDispatchCategoryOptions,
} from "./useDispatchCategoryOptions";

export type { AgentSelection, DispatchCategoryPaletteProps } from "./types";

export const DispatchCategoryPalette: React.FC<
  DispatchCategoryPaletteProps
> = ({
  isOpen,
  onClose,
  onGoBackToParent,
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
  titleLabel,
  titleIcon,
  placeholderLabel,
}) => {
  const { t: tCommon } = useTranslation("common");
  const [searchQuery, setSearchQuery] = useState("");
  const [cliAgentListFilterMode, setCliAgentListFilterMode] =
    useState<CliLaunchMode>(CLI_LAUNCH_MODE.GUI);

  const {
    allOptions,
    groups,
    accounts,
    rustCompatibleAccounts,
    rustIncompatibleAccounts,
    optionToItem,
  } = useDispatchCategoryOptions({
    isOpen,
    hideOrgs,
    hideCliAgents,
    allowedCliAgentTypes,
    cliOnly,
    cliLaunchMode: cliAgentListFilterMode,
    includeHumanSession,
    currentCategory,
    currentAgentDefinitionId,
    currentAgentOrgId,
    currentCliAgentType,
    onSelect,
    onClose,
  });

  const { filteredItems: filteredOptions } = useFilteredItems({
    items: allOptions,
    searchQuery,
    getSearchText: (option) => `${option.name} ${option.desc}`,
  });

  // ============ BUILD ITEMS WITH GROUP HEADERS ============

  const isSearching = searchQuery.trim().length > 0;

  const items = useMemo(
    (): SpotlightItem[] =>
      isSearching
        ? filteredOptions.map((option) => optionToItem(option))
        : buildGroupedSpotlightItems(groups, optionToItem),
    [isSearching, filteredOptions, groups, optionToItem]
  );

  // ============ KERNEL ============

  const isItemSelectable = useCallback((item: SpotlightItem) => {
    const data = item.data as Record<string, unknown> | undefined;
    return !data?.isHeader && !data?.disabled;
  }, []);

  const handleExternalKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      internalHandleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
    ) => {
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        searchQuery === "" &&
        onGoBackToParent
      ) {
        event.preventDefault();
        onGoBackToParent();
        return;
      }
      internalHandleKeyDown(event);
    },
    [searchQuery, onGoBackToParent]
  );

  const kernel = useSelectorKernel({
    isOpen,
    onClose,
    items,
    isItemSelectable,
    externalSearchQuery: searchQuery,
    externalSetSearchQuery: setSearchQuery,
    onReset: () => setSearchQuery(""),
    externalHandleKeyDown: onGoBackToParent ? handleExternalKeyDown : undefined,
  });

  const containerHeight = Math.min(88 + items.length * 40, 400);

  // ============ FOOTER: show compatible accounts for hovered agent ============
  const hoveredItem = items[kernel.selectedIndex];
  const afterListSlot = useAccountFooterForHovered({
    hoveredItem,
    resolve: useCallback(
      (item) => {
        const itemData = item.data as Record<string, unknown> | undefined;
        const optionId = (itemData?.optionId as string | undefined) ?? item.id;
        const option = allOptions.find((opt) => opt.id === optionId);
        if (!option) return null;
        // Cursor IDE manages its own auth — no ORGII-side accounts
        // are relevant. Returning null keeps the footer empty.
        if (
          option.category === "cursor_ide" ||
          option.category === "human_session"
        )
          return null;
        if (option.isCli && option.cliAgentType) {
          return {
            mode: "cli",
            agentType: option.cliAgentType,
            accounts,
          };
        }
        return {
          mode: "api",
          accounts: rustCompatibleAccounts,
          showIncompatible: true,
          incompatibleAccounts: rustIncompatibleAccounts,
        };
      },
      [allOptions, accounts, rustCompatibleAccounts, rustIncompatibleAccounts]
    ),
  });

  const footerAction = <ManageAgentsFooterAction onClose={onClose} />;
  const inputLeadingSlot = (
    <CliAgentListFilterSwitch
      mode={cliAgentListFilterMode}
      onModeChange={setCliAgentListFilterMode}
    />
  );

  // When the caller pre-selects a target (e.g. an org member row), surface
  const path = useMemo<PathSegment[]>(() => {
    const label =
      titleLabel ?? tCommon("filters.searchAgentOrOrg", "Select Agent");
    return [
      {
        type: "action",
        id: "dispatch-category-title",
        label,
        icon: titleIcon ?? "",
        color: "primary",
      },
    ];
  }, [titleLabel, titleIcon, tCommon]);

  return (
    <SpotlightShell isOpen={isOpen} onClose={onClose}>
      <PaletteBody
        kernel={kernel}
        items={items}
        placeholder={placeholderLabel ?? tCommon("filters.searchAgentOrOrg")}
        path={inputLeadingSlot ? [] : path}
        onRemoveSegment={
          inputLeadingSlot ? undefined : (onGoBackToParent ?? onClose)
        }
        inputLeadingSlot={inputLeadingSlot}
        containerHeight={containerHeight}
        afterListSlot={afterListSlot}
      />
      <ShellFooterAction>{footerAction}</ShellFooterAction>
    </SpotlightShell>
  );
};
