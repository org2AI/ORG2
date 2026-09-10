/**
 * Shortcuts Section - VS Code-style keyboard shortcuts viewer
 *
 * Features:
 * - Searchable table of all shortcuts
 * - Filter by system (Mac / Windows / Linux) — defaults to the user's
 *   current OS so the displayed keys match their actual keyboard
 * - Filter by category
 * - Organized by scope
 */
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Message from "@src/components/Message";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
  type SettingsTableSelectFilter,
} from "@src/components/SettingsTable";
import {
  CURRENT_SHORTCUT_PLATFORM,
  resetShortcutBindings,
} from "@src/config/keyboard/shortcutBindings";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import {
  ALL_SHORTCUTS,
  CATEGORY_CONFIG,
  SCOPE_LABELS,
  type ShortcutCategory,
  type ShortcutEntry,
  getCategories,
} from "@src/config/keyboard/shortcuts";
import { useShortcutBindings } from "@src/config/keyboard/useShortcutBindings";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import ShortcutRecorder from "./ShortcutRecorder";

type OsFilter = "mac" | "windows" | "linux";

const CURRENT_OS = CURRENT_SHORTCUT_PLATFORM;

const ShortcutsSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const overrides = useShortcutBindings();
  const hasChanges = Object.values(overrides).some(
    (entries) => entries && Object.keys(entries).length > 0
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    ShortcutCategory | "all"
  >("all");
  const [selectedOs, setSelectedOs] = useState<OsFilter>(CURRENT_OS);

  // Only Mac has a distinct symbol set; Linux conventionally shares the
  // Windows/Ctrl-based keybindings.
  const useMacKeys = selectedOs === "mac";

  const categories = useMemo(() => getCategories(), []);

  const tableFilters = useMemo<SettingsTableSelectFilter[]>(
    () => [
      {
        key: "system",
        value: selectedOs,
        // No "all" option: a shortcut row can only display one keystroke
        // column at a time. The OS filter is always "active" and resets
        // to the user's current platform.
        defaultValue: CURRENT_OS,
        options: [
          { value: "mac", label: t("shortcuts.systemMac") },
          { value: "windows", label: t("shortcuts.systemWindows") },
          { value: "linux", label: t("shortcuts.systemLinux") },
        ],
        onChange: (value) => {
          setRecordingId(null);
          setSelectedOs(value as OsFilter);
        },
        minWidth: 120,
      },
      {
        key: "category",
        value: selectedCategory,
        defaultValue: "all",
        options: [
          { value: "all", label: t("shortcuts.allTab") },
          ...categories.map((category) => ({
            value: category,
            label: CATEGORY_CONFIG[category]?.label || category,
          })),
        ],
        onChange: (value) =>
          setSelectedCategory(value as ShortcutCategory | "all"),
        minWidth: 140,
      },
    ],
    [categories, selectedCategory, selectedOs, t]
  );

  // Filter shortcuts based on search and category
  const filteredShortcuts = (() => {
    let shortcuts = ALL_SHORTCUTS;

    // Filter by category
    if (selectedCategory !== "all") {
      shortcuts = shortcuts.filter(
        (shortcut) => shortcut.category === selectedCategory
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      shortcuts = shortcuts.filter(
        (shortcut) =>
          shortcut.command.toLowerCase().includes(query) ||
          getShortcutKeys(shortcut.id, { platform: selectedOs })
            .toLowerCase()
            .includes(query) ||
          SCOPE_LABELS[shortcut.scope]?.toLowerCase().includes(query) ||
          CATEGORY_CONFIG[shortcut.category]?.label
            .toLowerCase()
            .includes(query)
      );
    }

    return shortcuts;
  })();

  const columns: SettingsTableColumn<ShortcutEntry>[] = useMemo(
    () => [
      {
        key: "command",
        label: t("shortcuts.command"),
        width: "320px",
        sorter: (entryA, entryB) =>
          entryA.command.localeCompare(entryB.command),
        renderCell: (entry) => (
          <span className={SETTINGS_TABLE_CELL.primary}>{entry.command}</span>
        ),
      },
      {
        key: "keybinding",
        label: t("shortcuts.keybinding"),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (entry) => (
          <ShortcutRecorder
            key={`${entry.id}:${selectedOs}`}
            id={entry.id}
            command={entry.command}
            platform={selectedOs}
            recording={recordingId === entry.id}
            onRecord={setRecordingId}
          />
        ),
      },
      {
        key: "context",
        label: `${t("shortcuts.when")} / ${t("shortcuts.category")}`,
        width: "180px",
        sorter: (entryA, entryB) => {
          const scopeCompare = entryA.scope.localeCompare(entryB.scope);
          if (scopeCompare !== 0) return scopeCompare;
          return entryA.category.localeCompare(entryB.category);
        },
        renderCell: (entry) => (
          <div className="inline-flex items-center whitespace-nowrap text-text-2">
            <span>{SCOPE_LABELS[entry.scope] || entry.scope}</span>
            <span className="mx-2 h-3.5 w-px bg-border-2" />
            <span>
              {CATEGORY_CONFIG[entry.category]?.label || entry.category}
            </span>
          </div>
        ),
      },
    ],
    [t, selectedOs, recordingId]
  );

  return (
    <div className="flex w-full flex-col gap-4">
      {hasChanges && (
        <SectionContainer>
          <SectionRow
            label={t("shortcuts.resetAll")}
            description={t("shortcuts.resetAllDesc")}
          >
            <Button
              onClick={() => {
                try {
                  resetShortcutBindings();
                } catch {
                  Message.error(t("shortcuts.saveFailed"));
                }
              }}
            >
              {t("shortcuts.reset")}
            </Button>
          </SectionRow>
        </SectionContainer>
      )}
      <SettingsTable<ShortcutEntry>
        hover
        rowClassName="group/shortcut-row"
        selectFilters={tableFilters}
        searchBar={{
          searchValue: searchQuery,
          onSearchChange: setSearchQuery,
          searchPlaceholder: t("shortcuts.searchPlaceholder"),
          allowSearchClear: true,
        }}
        columns={columns}
        rows={filteredShortcuts}
        getRowKey={(entry) => entry.id}
        headerHeight="tall"
        emptyTitle={t("shortcuts.noResults")}
        emptySubtitle={searchQuery ? t("shortcuts.noResultsHint") : undefined}
      />

      <div className="rounded-lg bg-primary-container p-4">
        <div className="mb-2 text-sm font-medium text-text-1">
          {t("shortcuts.tipsHeading")}
        </div>
        <ul className="space-y-1 text-xs text-text-3">
          <li>
            {"• "}
            {useMacKeys
              ? t("shortcuts.tipsModifiersMac")
              : t("shortcuts.tipsModifiersWin")}
          </li>
          <li>{`• ${t("shortcuts.tipsEditorScope")}`}</li>
          <li>{`• ${t("shortcuts.tipsContextual")}`}</li>
          <li>{`• ${t("shortcuts.tipsSearchHint")}`}</li>
        </ul>
      </div>
    </div>
  );
};

export default ShortcutsSection;
