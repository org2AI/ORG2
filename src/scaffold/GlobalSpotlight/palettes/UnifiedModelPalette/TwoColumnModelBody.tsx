/**
 * TwoColumnModelBody
 *
 * Renders the UnifiedModelPalette content area:
 *
 *   │ Pinned + Recent Models (full width)          │
 *   ├──────────────────────┬──────────────────────┤
 *   │ Choose model (left)  │ Choose key (right)    │
 *   └──────────────────────┴──────────────────────┘
 *
 * With `keyFirst` the two lower columns swap roles: keys on the left,
 * the focused key's models on the right. The data flow is unchanged —
 * `items` still drives the left column and `sourceItems` the right one.
 *
 * The left column (pins + recents + models) is keyboard-driven by the shared
 * selector kernel; `selectedIndex` indexes the flat `items` array. The
 * right column is a manual list keyed by `selectedSourceIndex`.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";
import { useKeyboardMouseMode } from "@src/hooks/keyboard";

import { SpotlightItemRow } from "../../components/SpotlightItemRow";
import type { SpotlightItem } from "../../types";
import { MODEL_SECTION } from "./modelSection";

// ============ TYPES ============

interface TwoColumnModelBodyProps {
  /**
   * Flat kernel list:
   * [pinned header?, pins…, recent header?, recents…, all header, models…].
   */
  items: SpotlightItem[];
  /** Kernel cursor over `items`. */
  selectedIndex: number;
  onItemSelect: (item: SpotlightItem, index: number) => void;
  onItemHover: (index: number) => void;
  searchQuery: string;
  activeColumn: "models" | "sources";
  /** Keys (left) → models (right) instead of models → keys. */
  keyFirst?: boolean;
  /**
   * Right-column rows: compatible accounts for the focused model, or in
   * key-first mode the focused key's model families.
   */
  sourceItems: SpotlightItem[];
  selectedSourceIndex: number;
  /** Whether a model (or key, in key-first mode) row owns the left cursor. */
  hasFocusedModel: boolean;
  /** Whether the Key Vault account list is currently loading. */
  accountsLoading: boolean;
  /** Key Vault account-list load error. */
  accountsError: string | null;
  /** Retry loading Key Vault accounts after an error. */
  onRetryAccounts: () => void;
  onSourceSelect: (index: number) => void;
  onSourceHover: (index: number) => void;
}

// ============ CONSTANTS ============

const COLUMN_HEIGHT = 260;
const RECENT_MAX_HEIGHT = 220;

// ============ HELPERS ============

function isHeader(item: SpotlightItem): boolean {
  return Boolean((item.data as Record<string, unknown> | undefined)?.isHeader);
}

const QUICK_PICK_SECTIONS: ReadonlySet<string> = new Set([
  MODEL_SECTION.PINNED,
  MODEL_SECTION.RECENT,
]);

interface IndexedRow {
  item: SpotlightItem;
  index: number;
}

function getSection(item: SpotlightItem): string | undefined {
  return (item.data as Record<string, unknown> | undefined)?.modelSection as
    | string
    | undefined;
}

// ============ SUB-COMPONENTS ============

interface RowListProps {
  rows: IndexedRow[];
  selectedIndex: number;
  isKeyboardMode: boolean;
  searchQuery: string;
  onSelect: (item: SpotlightItem, index: number) => void;
  onHover: (index: number) => void;
}

const RowList: React.FC<RowListProps> = ({
  rows,
  selectedIndex,
  isKeyboardMode,
  searchQuery,
  onSelect,
  onHover,
}) =>
  rows.map(({ item, index }) => (
    <SpotlightItemRow
      key={item.id}
      item={item}
      selectionState={item.data?.selectionState}
      index={index}
      isSelected={selectedIndex === index}
      isKeyboardMode={isKeyboardMode}
      onSelect={() => onSelect(item, index)}
      onHover={onHover}
      searchQuery={searchQuery}
      showDetailPane={false}
    />
  ));

/** A vertically-scrolling column of indexed rows. */
const ScrollColumn: React.FC<{
  maxHeight: number;
  onMouseMove: (event: React.MouseEvent) => void;
  dataKeyboardMode: string;
  children: React.ReactNode;
}> = ({ maxHeight, onMouseMove, dataKeyboardMode, children }) => (
  <div
    className="spotlight-scrollable overflow-y-auto"
    style={{ maxHeight }}
    onMouseMove={onMouseMove}
    data-keyboard-mode={dataKeyboardMode}
  >
    {children}
  </div>
);

const SECTION_LABEL_CLASS =
  "px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-text-3 uppercase";

// ============ MAIN COMPONENT ============

export const TwoColumnModelBody: React.FC<TwoColumnModelBodyProps> = ({
  items,
  selectedIndex,
  onItemSelect,
  onItemHover,
  searchQuery,
  activeColumn,
  keyFirst = false,
  sourceItems,
  selectedSourceIndex,
  hasFocusedModel,
  accountsLoading,
  accountsError,
  onRetryAccounts,
  onSourceSelect,
  onSourceHover,
}) => {
  const { t } = useTranslation();
  const { isKeyboardMode, handleMouseMove, dataKeyboardMode } =
    useKeyboardMouseMode();

  // Split the flat list into quick-pick groups (Pinned, Recent) vs
  // All-Models rows, preserving each row's index into the flat `items`
  // array (kernel cursor space). The "All Models" header stays in `items`
  // only as a non-selectable kernel divider; it is not rendered — the
  // Step 1 / Step 2 titles already label the two columns.
  const { quickPickGroups, modelRows } = useMemo(() => {
    const groups = new Map<
      string,
      { header: SpotlightItem | null; rows: IndexedRow[] }
    >();
    const groupFor = (section: string) => {
      let group = groups.get(section);
      if (!group) {
        group = { header: null, rows: [] };
        groups.set(section, group);
      }
      return group;
    };
    const models: IndexedRow[] = [];

    items.forEach((item, index) => {
      if (isHeader(item)) {
        const section = item.id.slice(item.id.lastIndexOf(":") + 1);
        if (QUICK_PICK_SECTIONS.has(section)) groupFor(section).header = item;
        return;
      }
      const section = getSection(item);
      if (section && QUICK_PICK_SECTIONS.has(section)) {
        groupFor(section).rows.push({ item, index });
      } else {
        models.push({ item, index });
      }
    });

    return {
      quickPickGroups: Array.from(groups, ([section, group]) => ({
        section,
        ...group,
      })).filter((group) => group.rows.length > 0),
      modelRows: models,
    };
  }, [items]);

  const sourcesColumnActive = activeColumn === "sources";
  const hasQuickPickSection = quickPickGroups.length > 0;

  const leftTitle = keyFirst
    ? t("selectors.modelSelector.chooseKey")
    : t("selectors.modelSelector.chooseModel");
  const rightTitle = keyFirst
    ? t("selectors.modelSelector.chooseModel")
    : t("selectors.modelSelector.chooseKey");
  const rightEmptyTitle = hasFocusedModel
    ? keyFirst
      ? t("selectors.modelSelector.noModelsForKey")
      : t("selectors.modelSelector.noCompatibleAccounts")
    : keyFirst
      ? t("selectors.modelSelector.chooseKeyHint")
      : t("selectors.modelSelector.chooseModelHint");

  return (
    <div className="flex flex-col">
      {/* ── Pinned + Recent (full width, one-click) ─────────────────── */}
      {hasQuickPickSection && (
        <div className="border-b border-border-1">
          <ScrollColumn
            maxHeight={RECENT_MAX_HEIGHT}
            onMouseMove={handleMouseMove}
            dataKeyboardMode={dataKeyboardMode}
          >
            {quickPickGroups.map(({ section, header, rows }) => (
              <React.Fragment key={section}>
                {header && (
                  <div className={SECTION_LABEL_CLASS}>{header.label}</div>
                )}
                <RowList
                  rows={rows}
                  selectedIndex={selectedIndex}
                  isKeyboardMode={isKeyboardMode}
                  searchQuery={searchQuery}
                  onSelect={onItemSelect}
                  onHover={onItemHover}
                />
              </React.Fragment>
            ))}
          </ScrollColumn>
        </div>
      )}

      {/* ── Models | Accounts (two columns) ──────────────────────────── */}
      <div className="flex items-stretch">
        {/* Left: models (or keys in key-first mode) */}
        <div className="flex w-2/5 flex-col">
          <div className={SECTION_LABEL_CLASS}>{`Step 1 - ${leftTitle}`}</div>
          {modelRows.length > 0 ? (
            <ScrollColumn
              maxHeight={COLUMN_HEIGHT}
              onMouseMove={handleMouseMove}
              dataKeyboardMode={dataKeyboardMode}
            >
              <RowList
                rows={modelRows}
                selectedIndex={selectedIndex}
                isKeyboardMode={isKeyboardMode}
                searchQuery={searchQuery}
                onSelect={onItemSelect}
                onHover={() => undefined}
              />
            </ScrollColumn>
          ) : (
            <div
              className="flex items-center justify-center"
              style={{ height: COLUMN_HEIGHT }}
            >
              <Placeholder
                variant={
                  searchQuery.trim()
                    ? "no-results"
                    : accountsLoading
                      ? "loading"
                      : accountsError
                        ? "error"
                        : "empty"
                }
                title={
                  searchQuery.trim()
                    ? t("common:common.noResults")
                    : accountsLoading
                      ? t("placeholders.loading")
                      : accountsError
                        ? t("placeholders.failedToLoad")
                        : t("placeholders.noItemsAvailable")
                }
                subtitle={accountsError ?? undefined}
                onRetry={accountsError ? onRetryAccounts : undefined}
                placement="sidebar"
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col py-2">
          <div className="w-px flex-1 bg-border-1" />
        </div>

        {/* Right: accounts for the focused model (or models for the key) */}
        <div className="flex w-3/5 flex-col">
          <div className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-text-3 uppercase">
            {`Step 2 - ${rightTitle}`}
          </div>
          {!hasFocusedModel || sourceItems.length === 0 ? (
            <div
              className="flex items-center justify-center px-4"
              style={{ height: COLUMN_HEIGHT }}
            >
              <Placeholder
                variant="empty"
                title={rightEmptyTitle}
                placement="sidebar"
              />
            </div>
          ) : (
            <div
              className="spotlight-scrollable overflow-y-auto"
              style={{ maxHeight: COLUMN_HEIGHT }}
              onMouseMove={handleMouseMove}
              data-keyboard-mode={dataKeyboardMode}
            >
              {sourceItems.map((source, index) => (
                <SpotlightItemRow
                  key={source.id}
                  item={source}
                  selectionState={source.data?.selectionState}
                  index={index}
                  isSelected={
                    sourcesColumnActive && selectedSourceIndex === index
                  }
                  isKeyboardMode={isKeyboardMode}
                  onSelect={() => onSourceSelect(index)}
                  onHover={() => onSourceHover(index)}
                  searchQuery=""
                  showDetailPane={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
