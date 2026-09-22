/**
 * The search field shared by SettingsTable's two toolbar layouts (the stacked
 * `SearchSortBar` and the inline toolbar), so both get the same prefix icon,
 * clear affordance, and keyboard shortcut.
 *
 * ⌘F / Ctrl+F focuses the field by default — every searchable settings table
 * answers the same chord, arbitrated by `useSearchShortcut` so only the
 * foreground field responds. The key hint shows inside the field while it is
 * empty and unfocused: it gets out of the way the moment it has served its
 * purpose, and never collides with the clear button. Pass
 * `searchShortcut={false}` to opt a table out.
 */
import React, { useId, useRef, useState } from "react";

import Input, { type InputProps } from "@src/components/Input";
import KeyboardShortcut from "@src/components/KeyboardShortcut";
import {
  DEFAULT_SEARCH_SHORTCUT_ID,
  useSearchShortcut,
} from "@src/hooks/keyboard/useSearchShortcut";
import { HugeiconsIcon, Search01Icon } from "@src/icons";

/** A table's search shortcut. On by default; `false` opts out. */
export type SettingsTableSearchShortcut =
  | boolean
  | {
      /** Registered shortcut id. Default: `list_search` (⌘F / Ctrl+F). */
      shortcutId?: string;
      /** Keep the binding but drop the inline key hint. */
      hideHint?: boolean;
    };

export interface SettingsTableSearchInputProps {
  value: string;
  placeholder?: string;
  size?: InputProps["size"];
  onChange: (value: string) => void;
  onClear?: () => void;
  allowClear?: boolean;
  shortcut?: SettingsTableSearchShortcut;
  className?: string;
}

export function SettingsTableSearchInput({
  value,
  placeholder,
  size,
  onChange,
  onClear,
  allowClear = true,
  shortcut,
  className = "w-full min-w-0",
}: SettingsTableSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const hintId = useId();

  const config = typeof shortcut === "object" ? shortcut : {};
  const shortcutEnabled = shortcut !== false;
  const shortcutId = config.shortcutId ?? DEFAULT_SEARCH_SHORTCUT_ID;

  useSearchShortcut(inputRef, { shortcutId, enabled: shortcutEnabled });

  const showHint =
    shortcutEnabled && !config.hideHint && !focused && value.length === 0;

  return (
    <Input
      ref={inputRef}
      className={className}
      type="search"
      size={size}
      value={value}
      placeholder={placeholder}
      aria-describedby={showHint ? hintId : undefined}
      prefix={
        <HugeiconsIcon
          icon={Search01Icon}
          data-icon="search"
          size={14}
          className="text-text-3"
          aria-hidden
        />
      }
      suffix={
        showHint ? (
          <span id={hintId} className="pointer-events-none flex items-center">
            <KeyboardShortcut shortcutId={shortcutId} size="sm" />
          </span>
        ) : undefined
      }
      onChange={(next) => onChange(next)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      allowClear={allowClear}
      onClear={onClear}
    />
  );
}

export default SettingsTableSearchInput;
