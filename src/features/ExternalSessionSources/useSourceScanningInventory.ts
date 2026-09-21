/**
 * Source-scanning inventory state and its mutations: the one-shot detect +
 * stats fan-out on mount, per-source rescan/reprobe, "rescan all", and the
 * enabled toggle. Kept out of `SourceScanningSettings` so its render body only
 * wires this state to columns and JSX.
 */
import { useAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ExternalCliSourceProbe,
  type ExternalHistoryScanResult,
  type ImportedHistorySourceId,
  externalCliSourceProbe,
  externalCliSourcesDetect,
  externalHistoryRescanSource,
  externalHistoryRescanSources,
  fetchExternalSourceStats,
  fetchExternalSourceStatsBatch,
  splitScanSourcesByOutcome,
} from "@src/api/tauri/externalHistory";
import { loadSessionRoster } from "@src/store/session";
import {
  type DataSourceConfigMap,
  dataSourceConfigAtom,
  dataSourceScanFailureAtom,
  getSourceConfig,
  reduceDataSourceScanFailures,
} from "@src/store/session/dataSourceConfigAtom";

import { isImportableId } from "./sourceScanningHelpers";
import type { SourceRow } from "./sourceScanningTypes";

export function useSourceScanningInventory() {
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [rescanningAll, setRescanningAll] = useState(false);
  const [configMap, setConfigMap] = useAtom(dataSourceConfigAtom);
  // Importer failures from every rescan surface, including the background
  // scheduler, so a broken source reads as an error rather than "ready".
  const [scanFailures, setScanFailures] = useAtom(dataSourceScanFailureAtom);
  const panelMountedRef = useRef(false);

  useEffect(() => {
    panelMountedRef.current = true;
    return () => {
      panelMountedRef.current = false;
    };
  }, []);

  const patchRow = useCallback(
    (sourceId: string, patch: Partial<SourceRow>) => {
      if (!panelMountedRef.current) return;
      setRows((prev) =>
        prev
          ? prev.map((row) =>
              row.probe.sourceId === sourceId ? { ...row, ...patch } : row
            )
          : prev
      );
    },
    []
  );

  const updateConfig = useCallback(
    (sourceId: string, patch: Partial<DataSourceConfigMap[string]>) => {
      setConfigMap((prev) => ({
        ...prev,
        [sourceId]: { ...getSourceConfig(prev, sourceId), ...patch },
      }));
    },
    [setConfigMap]
  );

  const loadStats = useCallback(
    async (sourceId: ImportedHistorySourceId) => {
      patchRow(sourceId, { statsLoading: true, error: false });
      try {
        const stats = await fetchExternalSourceStats(sourceId);
        patchRow(sourceId, { stats, statsLoading: false });
      } catch {
        patchRow(sourceId, { statsLoading: false, error: true });
      }
    },
    [patchRow]
  );

  // Snapshot config for the initial detect effect without re-running on change.
  const configRef = useRef(configMap);
  configRef.current = configMap;

  // This component is mounted only while Scanning is active, so detection and
  // the stats fan-out start on entry and their local results are dropped when
  // the user navigates away.
  const loadScanningInventory = useCallback(async () => {
    let probes: ExternalCliSourceProbe[] = [];
    try {
      probes = await externalCliSourcesDetect();
    } catch {
      if (panelMountedRef.current) setRows([]);
      return;
    }
    if (!panelMountedRef.current) return;

    const built: SourceRow[] = probes
      .map((probe) => {
        const importable = probe.importable && isImportableId(probe.sourceId);
        const enabled = getSourceConfig(
          configRef.current,
          probe.sourceId
        ).enabled;
        return {
          probe,
          importable,
          stats: null,
          statsLoading: importable && enabled,
          rescanning: false,
          error: false,
        };
      })
      .sort((a, b) => {
        const rank = (r: SourceRow) =>
          r.importable ? 0 : r.probe.installed ? 1 : 2;
        return (
          rank(a) - rank(b) ||
          a.probe.displayName.localeCompare(b.probe.displayName)
        );
      });
    setRows(built);
    const enabledSourceIds = built.flatMap((row) =>
      row.importable &&
      isImportableId(row.probe.sourceId) &&
      getSourceConfig(configRef.current, row.probe.sourceId).enabled
        ? [row.probe.sourceId as ImportedHistorySourceId]
        : []
    );
    try {
      const statsBySource =
        await fetchExternalSourceStatsBatch(enabledSourceIds);
      if (!panelMountedRef.current) return;
      setRows(
        (previous) =>
          previous?.map((row) => {
            if (!isImportableId(row.probe.sourceId)) return row;
            const stats = statsBySource.get(row.probe.sourceId);
            return stats
              ? { ...row, stats, statsLoading: false }
              : { ...row, statsLoading: false };
          }) ?? previous
      );
    } catch {
      if (!panelMountedRef.current) return;
      setRows(
        (previous) =>
          previous?.map((row) =>
            enabledSourceIds.includes(
              row.probe.sourceId as ImportedHistorySourceId
            )
              ? { ...row, statsLoading: false, error: true }
              : row
          ) ?? previous
      );
    }
  }, []);

  useEffect(() => {
    void loadScanningInventory();
  }, [loadScanningInventory]);

  // Re-run detection for one source (install status, path, store kind).
  const reprobe = useCallback(
    async (sourceId: string) => {
      try {
        const probe = await externalCliSourceProbe(sourceId);
        if (probe) patchRow(sourceId, { probe });
      } catch {
        /* keep the last-known probe */
      }
    },
    [patchRow]
  );

  // Manual incremental update by default; the split action can request a full
  // cache rebuild. Every pass also re-probes install/store state and stamps
  // lastScannedAt — unless the importer itself failed, which is not a scan.
  const handleRescan = useCallback(
    async (row: SourceRow, clear = false) => {
      const sourceId = row.probe.sourceId;
      patchRow(sourceId, { rescanning: true, error: false });
      let importerFailed = false;
      try {
        if (row.importable && isImportableId(sourceId)) {
          let scanResult: ExternalHistoryScanResult;
          try {
            scanResult = await externalHistoryRescanSource(sourceId, {
              clear,
            });
          } catch (error) {
            importerFailed = true;
            const message =
              error instanceof Error ? error.message : String(error);
            setScanFailures((previous) =>
              reduceDataSourceScanFailures(
                previous,
                [],
                [{ sourceId, error: message }],
                Date.now()
              )
            );
            throw error;
          }
          setScanFailures((previous) =>
            reduceDataSourceScanFailures(previous, [sourceId], [], Date.now())
          );
          if (!panelMountedRef.current) return;
          if (scanResult.changedSources.length > 0) {
            await loadSessionRoster({ forceRefresh: true });
            if (!panelMountedRef.current) return;
          }
          await loadStats(sourceId);
        }
        if (!panelMountedRef.current) return;
        await reprobe(sourceId);
      } catch {
        patchRow(sourceId, { error: true });
      } finally {
        patchRow(sourceId, { rescanning: false });
        if (!importerFailed) {
          updateConfig(sourceId, { lastScannedAt: Date.now() });
        }
      }
    },
    [loadStats, patchRow, reprobe, setScanFailures, updateConfig]
  );

  const handleRescanAll = useCallback(async () => {
    const current = rows ?? [];
    if (current.length === 0) return;
    setRescanningAll(true);
    setRows(
      (prev) =>
        prev?.map((r) => ({ ...r, rescanning: true, error: false })) ?? prev
    );
    const importables = current
      .filter(
        (r) =>
          r.importable &&
          isImportableId(r.probe.sourceId) &&
          getSourceConfig(configRef.current, r.probe.sourceId).enabled
      )
      .map((r) => r.probe.sourceId as ImportedHistorySourceId);
    try {
      const scanResult = await externalHistoryRescanSources(importables);
      // Recorded before the unmount bail-outs: the outcome is app-wide state
      // the scheduler backs off on, not panel-local state.
      const { succeeded, failed } = splitScanSourcesByOutcome(
        importables,
        scanResult
      );
      const scannedAt = Date.now();
      setScanFailures((previous) =>
        reduceDataSourceScanFailures(previous, succeeded, failed, scannedAt)
      );
      if (!panelMountedRef.current) return;
      if (scanResult.changedSources.length > 0) {
        await loadSessionRoster({ forceRefresh: true });
        if (!panelMountedRef.current) return;
      }
      const probes = await externalCliSourcesDetect();
      if (!panelMountedRef.current) return;
      const byId = new Map(probes.map((p) => [p.sourceId, p]));
      setRows(
        (prev) =>
          prev?.map((r) => {
            const probe = byId.get(r.probe.sourceId);
            return probe ? { ...r, probe } : r;
          }) ?? prev
      );
      const statsBySource = await fetchExternalSourceStatsBatch(importables);
      if (!panelMountedRef.current) return;
      setRows(
        (prev) =>
          prev?.map((row) => {
            if (!isImportableId(row.probe.sourceId)) return row;
            const stats = statsBySource.get(row.probe.sourceId);
            return stats ? { ...row, stats, statsLoading: false } : row;
          }) ?? prev
      );
      setConfigMap((prev) => {
        const next = { ...prev };
        for (const s of succeeded) {
          next[s] = { ...getSourceConfig(prev, s), lastScannedAt: scannedAt };
        }
        return next;
      });
    } catch {
      // Per-source errors surface via loadStats/reprobe; ignore the aggregate.
    } finally {
      if (panelMountedRef.current) {
        setRows(
          (prev) => prev?.map((r) => ({ ...r, rescanning: false })) ?? prev
        );
        setRescanningAll(false);
      }
    }
  }, [rows, setConfigMap, setScanFailures]);

  // Toggle a source on/off. Disabling clears it from the sidebar; enabling
  // loads it and stamps a scan.
  const toggleEnabled = useCallback(
    async (row: SourceRow, enabled: boolean) => {
      const sourceId = row.probe.sourceId;
      updateConfig(sourceId, { enabled });
      // Config write is synchronous in the shared store, so the reload below
      // already respects the new enabled state.
      await loadSessionRoster({ forceRefresh: true });
      if (enabled) {
        if (row.importable && isImportableId(sourceId)) {
          await loadStats(sourceId);
          updateConfig(sourceId, { lastScannedAt: Date.now() });
        }
      } else {
        patchRow(sourceId, { stats: null });
      }
    },
    [loadStats, patchRow, updateConfig]
  );

  return {
    rows,
    rescanningAll,
    configMap,
    scanFailures,
    handleRescan,
    handleRescanAll,
    toggleEnabled,
    updateConfig,
  };
}
