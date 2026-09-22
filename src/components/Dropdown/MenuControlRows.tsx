/**
 * MenuControlRows
 *
 * The label + trailing-control rows used by the in-context settings menus
 * (sidebar Layout / Appearance, session "…" Display / Input, launchpad "…",
 * file header Sidebar settings, Spotlight settings). Every row is a
 * `DROPDOWN_CLASSES.menuControlItem` with a truncating label on the left and
 * the control on the right; the control owns its own hover and click
 * handling, so toggling never closes the surrounding menu.
 */
import React from "react";

import SegmentedTextPill, {
  type SegmentedTextPillProps,
} from "@src/components/SegmentedTextPill";
import Switch from "@src/components/Switch";

import { DROPDOWN_CLASSES } from "./tokens";

const MENU_CONTROL_LABEL_CLASS = "min-w-0 flex-1 truncate";

interface MenuControlRowProps {
  label: string;
  /** The trailing control (a Switch, segmented pill, or composite pill). */
  children: React.ReactNode;
}

/** A menu row with a label and an arbitrary trailing control. */
export function MenuControlRow({ label, children }: MenuControlRowProps) {
  return (
    <div className={DROPDOWN_CLASSES.menuControlItem}>
      <span className={MENU_CONTROL_LABEL_CLASS}>{label}</span>
      {children}
    </div>
  );
}

interface MenuSwitchRowProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean, event: React.MouseEvent) => void;
  dataTestId?: string;
}

/** A menu row with a small Switch labelled by the row label. */
export function MenuSwitchRow({
  label,
  checked,
  onCheckedChange,
  dataTestId,
}: MenuSwitchRowProps) {
  return (
    <MenuControlRow label={label}>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        size="small"
        ariaLabel={label}
        dataTestId={dataTestId}
      />
    </MenuControlRow>
  );
}

interface MenuSegmentedRowProps<T extends string> {
  label: string;
  value: T | null;
  options: readonly SegmentedTextPillProps<T>["options"][number][];
  onChange: (value: T) => void;
  dataTestId?: string;
}

/** A menu row with a small segmented pill labelled by the row label. */
export function MenuSegmentedRow<T extends string>({
  label,
  value,
  options,
  onChange,
  dataTestId,
}: MenuSegmentedRowProps<T>) {
  return (
    <MenuControlRow label={label}>
      <SegmentedTextPill<T>
        ariaLabel={label}
        size="small"
        dataTestId={dataTestId}
        value={value}
        options={[...options]}
        onChange={onChange}
      />
    </MenuControlRow>
  );
}
