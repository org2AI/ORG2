import type { ReactNode } from "react";

type TableSurfaceMode = "readonly" | "editable";

export interface TableCellAddress {
  rowIndex: number;
  columnIndex: number;
}

export interface TableCellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface TableSurfaceColumn {
  id: string;
  label: string;
  width?: number;
  metaLabel?: string;
  badge?: string;
}

export interface TableSurfaceRow {
  id: string;
  cells: unknown[];
}

export interface TableSurfaceSortState {
  columnId: string | null;
  direction: "asc" | "desc";
}

export interface TableSurfaceProps {
  columns: TableSurfaceColumn[];
  rows: TableSurfaceRow[];
  mode?: TableSurfaceMode;
  className?: string;
  toolbarLeading?: ReactNode;
  toolbarTrailing?: ReactNode;
  showFormulaBar?: boolean;
  hasMoreRows?: boolean;
  loadingMoreRows?: boolean;
  sortState?: TableSurfaceSortState;
  onSortColumn?: (columnId: string) => void;
  emptyTitle?: string;
  emptySubtitle?: string;
  getCellClassName?: (
    address: TableCellAddress,
    value: unknown
  ) => string | undefined;
  formatCellValue?: (value: unknown, address: TableCellAddress) => string;
  onCellChange?: (address: TableCellAddress, value: string) => void;
  onPasteCells?: (
    address: TableCellAddress,
    values: string[][],
    activeRange: TableCellRange | null
  ) => void;
  onClearRange?: (range: TableCellRange) => void;
  onLoadMoreRows?: () => void | Promise<void>;
}
