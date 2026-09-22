/**
 * SidebarSectionLabel — the small uppercase group label above a run of sidebar
 * rows (PINNED, RECENTS, AGENTS, …).
 *
 * The app has two primary sidebars — the session sidebar (NavigationSidebar)
 * and the settings sidebar (SettingsSidebar) — and they are read as one family,
 * so the label's typography lives here once rather than as a copied class
 * string in each variant. `SIDEBAR_SECTION_LABEL_CLASS` is the text styling on
 * its own, for the collapsible session headers whose row is an interactive
 * `role="button"` that owns its own container classes.
 *
 * The row is `h-7` (28px) so a section label occupies the same box as a sidebar
 * row and the two sidebars line up.
 */
import type { ReactNode } from "react";

/** Typography for the label text itself. */
export const SIDEBAR_SECTION_LABEL_CLASS =
  "min-w-0 truncate text-[11px] font-medium tracking-wider text-text-2 uppercase";

/** The 28px row that holds a label (and an optional leading glyph). */
export const SIDEBAR_SECTION_LABEL_ROW_CLASS =
  "mb-px flex h-7 items-center gap-1.5 px-2";

export interface SidebarSectionLabelProps {
  label: ReactNode;
  /** Optional leading glyph, already rendered by the caller. */
  icon?: ReactNode;
}

export default function SidebarSectionLabel({
  label,
  icon,
}: SidebarSectionLabelProps) {
  return (
    <div className={SIDEBAR_SECTION_LABEL_ROW_CLASS}>
      {icon}
      <span className={SIDEBAR_SECTION_LABEL_CLASS}>{label}</span>
    </div>
  );
}
