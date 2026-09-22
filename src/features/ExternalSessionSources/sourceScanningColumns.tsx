/**
 * Builds the source-scanning settings-table column definitions: source
 * name/status, session + subagent counts, last scan time, and the combined
 * enable/frequency/rescan action column. Kept as a plain builder function
 * (not a hook/useMemo) since the panel recomputed this array on every render
 * before extraction — same behavior here.
 */
import type { TFunction } from "i18next";
import React, { type Dispatch, type SetStateAction } from "react";

import RefreshButton from "@src/components/Button/RefreshButton";
import Dropdown from "@src/components/Dropdown";
import Menu from "@src/components/Menu";
import type { IconProvider } from "@src/components/ModelIcon";
import Select from "@src/components/Select";
import type { SettingsTableColumn } from "@src/components/SettingsTable";
import {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
} from "@src/components/SettingsTable/tokens";
import SplitButton from "@src/components/SplitButton";
import Switch from "@src/components/Switch";
import Tag from "@src/components/Tag";
import { HugeiconsIcon, Refresh04Icon } from "@src/icons";
import {
  type DataSourceConfigMap,
  type DataSourceScanFailure,
  type SourceFrequency,
  getSourceConfig,
} from "@src/store/session/dataSourceConfigAtom";
import { formatRelativeElapsedShort } from "@src/util/data/formatters/date";

import SourceIcon from "./SourceIcon";
import { statusTagFor } from "./sourceScanningHelpers";
import type { SourceRow } from "./sourceScanningTypes";

export interface SourceScanningColumnsParams {
  t: TFunction<"sessions">;
  configMap: DataSourceConfigMap;
  /** Sources whose last importer run failed, from any rescan surface. */
  scanFailures: Record<string, DataSourceScanFailure>;
  sourceFrequencyOptions: { value: SourceFrequency; label: string }[];
  openRescanMenu: string | null;
  setOpenRescanMenu: Dispatch<SetStateAction<string | null>>;
  toggleEnabled: (row: SourceRow, enabled: boolean) => void | Promise<void>;
  updateConfig: (
    sourceId: string,
    patch: Partial<DataSourceConfigMap[string]>
  ) => void;
  handleRescan: (row: SourceRow, clear?: boolean) => void | Promise<void>;
  /** Card presentation. A card has no column headers, so the status tag takes
   *  the heading's right edge and the control cluster drops its header label. */
  cardView: boolean;
}

export function buildSourceScanningColumns({
  t,
  configMap,
  scanFailures,
  sourceFrequencyOptions,
  openRescanMenu,
  setOpenRescanMenu,
  toggleEnabled,
  updateConfig,
  handleRescan,
  cardView,
}: SourceScanningColumnsParams): SettingsTableColumn<SourceRow>[] {
  return [
    {
      key: "source",
      label: t("col.source"),
      sorter: (a, b) => a.probe.displayName.localeCompare(b.probe.displayName),
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        // A source can hold cached sessions from before it broke; its failed
        // importer must not read as "ready".
        const scanFailure = scanFailures[row.probe.sourceId];
        const statusTag = statusTagFor(
          scanFailure ? { ...row, error: true } : row,
          disabled
        );
        return (
          <span
            className={`${SETTINGS_TABLE_CELL.primaryIcon} min-w-0 ${
              cardView ? "flex w-full" : ""
            }`}
          >
            <span className="shrink-0 text-text-2">
              <SourceIcon iconId={row.probe.iconId as IconProvider} />
            </span>
            <span className="truncate">{row.probe.displayName}</span>
            <span
              className={`inline-flex shrink-0 ${cardView ? "ml-auto" : ""}`}
              title={disabled ? undefined : scanFailure?.error}
            >
              <Tag size="mini" color={statusTag.color} pill>
                {t(`status.${statusTag.labelKey}`)}
              </Tag>
            </span>
          </span>
        );
      },
    },
    {
      key: "sessions",
      label: t("col.sessions"),
      width: "84px",
      sorter: (a, b) =>
        (a.stats?.sessionCount ?? 0) - (b.stats?.sessionCount ?? 0),
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        return row.importable && !disabled && row.stats ? (
          <span className="text-text-2 tabular-nums">
            {row.stats.sessionCount}
          </span>
        ) : null;
      },
    },
    {
      key: "subagents",
      label: "Subagents",
      width: "84px",
      sorter: (a, b) =>
        (a.stats?.subagentCount ?? 0) - (b.stats?.subagentCount ?? 0),
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        if (!(row.importable && !disabled && row.stats)) return null;
        // Only Cursor has sub-agent sessions today; show a muted dash for the
        // sources that have none so the column doesn't read as a stray "0".
        return row.stats.subagentCount > 0 ? (
          <span className="text-text-2 tabular-nums">
            {row.stats.subagentCount}
          </span>
        ) : (
          <span className="text-text-4 tabular-nums">–</span>
        );
      },
    },
    {
      // Keep the combined control column pinned like the Settings CLI table.
      key: "actions",
      // A card shows the cluster on its own line, where a leading "auto scan"
      // label only repeats what the switch and selector already say.
      label: cardView ? undefined : t("col.frequency"),
      width: SETTINGS_TABLE_COL.hug,
      align: "right",
      renderCell: (row) => {
        const cfg = getSourceConfig(configMap, row.probe.sourceId);
        const disabled = row.importable && !cfg.enabled;
        return (
          <div className="flex items-center justify-end gap-2">
            {row.importable && (
              <>
                {!disabled && cfg.lastScannedAt ? (
                  <span
                    className="whitespace-nowrap text-text-3"
                    title={t("col.lastScan")}
                  >
                    {formatRelativeElapsedShort(new Date(cfg.lastScannedAt))}
                  </span>
                ) : null}
                <Switch
                  checked={cfg.enabled}
                  onCheckedChange={(checked) =>
                    void toggleEnabled(row, checked)
                  }
                  size="default"
                  ariaLabel={cfg.enabled ? t("disable") : t("enable")}
                />
                <Select
                  value={cfg.frequency}
                  onChange={(v) => {
                    if (typeof v === "string") {
                      updateConfig(row.probe.sourceId, {
                        frequency: v as SourceFrequency,
                      });
                    }
                  }}
                  options={sourceFrequencyOptions}
                  size="small"
                  disabled={disabled}
                  style={{ width: 120 }}
                  selectorClassName="text-left"
                  aria-label={t("frequencyTitle")}
                />
              </>
            )}
            {!disabled &&
              (row.importable ? (
                // Importable sources have a cache, so offer two rescan modes via
                // a split button: the main click runs Update (incremental
                // re-sync); the caret opens Update / Clear + rescan (full rebuild).
                // It remains icon-only because this dense row also owns a
                // frequency selector and a second menu action; its treatment
                // uses the same secondary treatment as the toolbar refresh.
                <SplitButton
                  size="small"
                  iconOnly
                  menuSegmentWidth={22}
                  loading={row.rescanning}
                  loadingSpinIcon
                  icon={
                    <HugeiconsIcon
                      icon={Refresh04Icon}
                      data-icon="refresh-cw"
                      size={14}
                    />
                  }
                  aria-label={t("rescan")}
                  title={t("rescan")}
                  onClick={() => void handleRescan(row, false)}
                  menuOpen={openRescanMenu === row.probe.sourceId}
                  menuButtonLabel={t("rescan")}
                  onMenuButtonClick={(event) => {
                    event.stopPropagation();
                    setOpenRescanMenu((current) =>
                      current === row.probe.sourceId ? null : row.probe.sourceId
                    );
                  }}
                  menu={
                    <Dropdown
                      trigger="click"
                      position="bottom-end"
                      popupVisible={openRescanMenu === row.probe.sourceId}
                      onVisibleChange={(visible) =>
                        setOpenRescanMenu(visible ? row.probe.sourceId : null)
                      }
                      getPopupContainer={() => document.body}
                      avoidViewportOverflow
                      droplist={
                        <Menu>
                          <Menu.Item
                            key="update"
                            onClick={() => {
                              setOpenRescanMenu(null);
                              void handleRescan(row, false);
                            }}
                          >
                            {t("rescanUpdate")}
                          </Menu.Item>
                          <Menu.Item
                            key="clear"
                            onClick={() => {
                              setOpenRescanMenu(null);
                              void handleRescan(row, true);
                            }}
                          >
                            {t("rescanClear")}
                          </Menu.Item>
                        </Menu>
                      }
                    >
                      <div />
                    </Dropdown>
                  }
                />
              ) : (
                <RefreshButton
                  variant="secondary"
                  size="small"
                  iconOnly
                  label={t("rescan")}
                  refreshing={row.rescanning}
                  onRefresh={() => void handleRescan(row)}
                />
              ))}
          </div>
        );
      },
    },
  ];
}
