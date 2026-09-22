/**
 * useDbPreview Hook
 *
 * Manages SQLite database preview lifecycle for the code editor.
 * Opens a .db file for browsing via SqliteProvider, lists tables,
 * and loads table data on demand using the existing DataGrid-compatible format.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ColumnInfo,
  QueryOptions,
  QueryResult,
  SqliteConnectionConfig,
  TableInfo,
} from "@src/engines/DatabaseCore";
import { createLogger } from "@src/hooks/logger";

import {
  DB_PREVIEW_PAGE_SIZE,
  type DbPreviewSortDirection,
  getNextDbPreviewSortState,
  withUpdatedDbPreviewTableRowCount,
} from "./dbPreviewUtils";

const log = createLogger("DbPreview");

interface DbPreviewState {
  tables: TableInfo[];
  selectedTable: string | null;
  schema: ColumnInfo[];
  tableData: QueryResult | null;
  connecting: boolean;
  loading: boolean;
  error: string | null;
  page: number;
  sortColumn: string | null;
  sortDirection: DbPreviewSortDirection;
}

const INITIAL_STATE: DbPreviewState = {
  tables: [],
  selectedTable: null,
  schema: [],
  tableData: null,
  connecting: true,
  loading: false,
  error: null,
  page: 1,
  sortColumn: null,
  sortDirection: "asc",
};

export interface UseDbPreviewReturn extends DbPreviewState {
  selectTable: (tableName: string) => void;
  loadPage: (page: number) => void;
  toggleSort: (columnName: string) => void;
  refresh: () => void;
}

interface SqliteService {
  getTables: () => Promise<TableInfo[]>;
  getTableSchema: (name: string) => Promise<ColumnInfo[]>;
  getTableData: (name: string, opts?: QueryOptions) => Promise<QueryResult>;
  disconnect: () => Promise<void>;
}

export function useDbPreview(filePath: string): UseDbPreviewReturn {
  const [state, setState] = useState<DbPreviewState>(INITIAL_STATE);
  const serviceRef = useRef<SqliteService | null>(null);
  const filePathRef = useRef(filePath);
  const generationRef = useRef(0);
  const requestRef = useRef(0);
  const stopRef = useRef<() => void>(() => {});
  const selectedTableRef = useRef<string | null>(null);
  const sortColumnRef = useRef<string | null>(null);
  const sortDirectionRef = useRef<DbPreviewSortDirection>("asc");

  useEffect(() => {
    selectedTableRef.current = state.selectedTable;
    sortColumnRef.current = state.sortColumn;
    sortDirectionRef.current = state.sortDirection;
  }, [state.selectedTable, state.sortColumn, state.sortDirection]);

  const loadTableData = useCallback(
    async (
      tableName: string,
      page: number,
      sortColumn?: string | null,
      sortDirection?: DbPreviewSortDirection
    ) => {
      const service = serviceRef.current;
      if (!service) return;
      const generation = generationRef.current;
      const request = ++requestRef.current;
      const current = () =>
        generation === generationRef.current &&
        request === requestRef.current &&
        service === serviceRef.current;

      const nextSortColumn =
        sortColumn === undefined ? sortColumnRef.current : sortColumn;
      const nextSortDirection = sortDirection ?? sortDirectionRef.current;

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const [schema, tableData] = await Promise.all([
          service.getTableSchema(tableName),
          service.getTableData(tableName, {
            page,
            pageSize: DB_PREVIEW_PAGE_SIZE,
            orderBy: nextSortColumn ?? undefined,
            orderDirection: nextSortColumn ? nextSortDirection : undefined,
          }),
        ]);

        if (!current()) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: null,
          schema,
          tableData,
          selectedTable: tableName,
          tables: withUpdatedDbPreviewTableRowCount(
            prev.tables,
            tableName,
            tableData.totalCount
          ),
          page,
          sortColumn: nextSortColumn,
          sortDirection: nextSortDirection,
        }));
      } catch (err) {
        if (!current()) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            err instanceof Error ? err.message : "Failed to load table data",
        }));
      }
    },
    []
  );

  const selectTable = useCallback(
    (tableName: string) => {
      loadTableData(tableName, 1, null, "asc");
    },
    [loadTableData]
  );

  const loadPage = useCallback(
    (page: number) => {
      const table = selectedTableRef.current;
      if (table) {
        loadTableData(table, page);
      }
    },
    [loadTableData]
  );

  const toggleSort = useCallback(
    (columnName: string) => {
      const table = selectedTableRef.current;
      if (!table) return;
      const nextSortState = getNextDbPreviewSortState(
        sortColumnRef.current,
        sortDirectionRef.current,
        columnName
      );
      loadTableData(table, 1, nextSortState.columnId, nextSortState.direction);
    },
    [loadTableData]
  );

  const connect = useCallback(async (path: string) => {
    stopRef.current();
    const generation = ++generationRef.current;
    ++requestRef.current;
    let active = true;
    let owned: SqliteService | null = null;
    const current = () => active && generation === generationRef.current;
    const stop = () => {
      active = false;
      ++requestRef.current;
      if (serviceRef.current === owned) serviceRef.current = null;
      void owned?.disconnect().catch(log.warn);
    };
    stopRef.current = stop;
    setState((_prev) => ({
      ...INITIAL_STATE,
      connecting: true,
    }));

    try {
      const { SqliteProvider } =
        await import("@src/engines/DatabaseCore/providers");
      const { isValidSqliteFile } =
        await import("@src/engines/DatabaseCore/providers/isValidSqliteFile");

      if (!current()) return;
      const valid = await isValidSqliteFile(path);
      if (!current()) return;
      if (!valid) {
        setState((prev) => ({
          ...prev,
          connecting: false,
          error: "Not a valid SQLite database file",
        }));
        return;
      }

      const config: SqliteConnectionConfig = {
        id: `preview-${Date.now()}`,
        name: path.split("/").pop() || "database",
        type: "sqlite",
        filePath: path,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const provider = new SqliteProvider(config);
      owned = provider;
      await provider.connect();
      if (!current()) {
        await provider.disconnect();
        return;
      }
      serviceRef.current = provider;

      const tables = await provider.getTables();
      if (!current()) return;
      const firstTable = tables[0];
      if (!firstTable) {
        setState((prev) => ({
          ...prev,
          connecting: false,
          tables,
          selectedTable: null,
        }));
        return;
      }

      const [schema, tableData] = await Promise.all([
        provider.getTableSchema(firstTable.name),
        provider.getTableData(firstTable.name, {
          page: 1,
          pageSize: DB_PREVIEW_PAGE_SIZE,
        }),
      ]);

      if (!current()) return;
      setState((prev) => ({
        ...prev,
        connecting: false,
        loading: false,
        tables: withUpdatedDbPreviewTableRowCount(
          tables,
          firstTable.name,
          tableData.totalCount
        ),
        selectedTable: firstTable.name,
        schema,
        tableData,
        page: 1,
        sortColumn: null,
        sortDirection: "asc",
      }));
    } catch (err) {
      if (!current()) return;
      stop();
      setState((prev) => ({
        ...prev,
        connecting: false,
        error: err instanceof Error ? err.message : "Failed to open database",
      }));
    }
  }, []);

  const refresh = useCallback(() => {
    void connect(filePathRef.current).catch(() => undefined);
  }, [connect]);

  useEffect(() => {
    filePathRef.current = filePath;
    connect(filePath);

    return () => {
      stopRef.current();
    };
  }, [filePath, connect]);

  return {
    ...state,
    selectTable,
    loadPage,
    toggleSort,
    refresh,
  };
}
