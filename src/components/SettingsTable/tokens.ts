import type { CSSProperties } from "react";

/**
 * Settings Table Cell Tokens
 *
 * All text inside SettingsTable cells inherits font-size: 13px
 * from `.table-settings .table-td` — never override with text-sm/text-xs
 * for regular cell content.
 *
 * Usage:
 * ```tsx
 * import { SETTINGS_TABLE_CELL } from "@src/components/SettingsTable/tokens";
 *
 * renderCell: (row) => <span className={SETTINGS_TABLE_CELL.primary}>{row.name}</span>
 * renderCell: (row) => <span className={SETTINGS_TABLE_CELL.value}>{row.size}</span>
 * ```
 */
export const SETTINGS_TABLE_CELL = {
  /** Primary label — first column or main identifier */
  primary: "text-text-1",
  /** Primary label with leading icon */
  primaryIcon: "inline-flex items-center gap-1.5 text-text-1",
  /** Data value — secondary columns like size, version */
  value: "text-text-2",
  /** Muted value — tertiary columns like percentage */
  muted: "text-text-3",
  /** Subtitle under primary text — deliberately smaller */
  subtitle: "text-xs text-text-3",
  /** Status row with icon + label inline */
  statusRow: "inline-flex items-center gap-1.5",
} as const;

/**
 * Column width presets for SettingsTable.
 *
 * | Token        | Use for                            | Sizing            |
 * |--------------|------------------------------------|--------------------|
 * | `fill`       | Primary text / label column        | Absorbs remaining  |
 * | `valueSm`    | Short values: "0 B", "Yes", status | Hug content        |
 * | `valueMd`    | Sized values: "93.4 MB", "77.8%"   | Comfortable fixed  |
 * | `valueLg`    | Spread-out tables (e.g. DB)       | 140px              |
 * | `hug`        | Action buttons, icon-only columns  | Shrink-wrap        |
 * | `control`    | Column with Select/Input           | Shrink-wrap        |
 * | `controlStyle` | Inline style for the control     | Fixed 200px        |
 *
 * All value/hug columns pair with `whitespace-nowrap` on cell content.
 */
export const SETTINGS_TABLE_COL = {
  /** Primary column — absorbs remaining space (auto layout distributes leftover here) */
  fill: "",
  /** Small value — version, status dot, short text — hug content */
  valueSm: "1%",
  /** Medium value — "93.4 MB", "77.8%" — guaranteed minimum width */
  valueMd: "110px",
  /** Large value — spread-out tables (e.g. DB clients) */
  valueLg: "140px",
  /** Shrink-wrap column — action buttons, icons */
  hug: "1%",
  /** Column containing a Select or Input — shrink-wraps around the control */
  control: "1%",
  /** Inline style for the Select/Input inside a control column */
  controlStyle: { width: 200 } as CSSProperties,
} as const;
