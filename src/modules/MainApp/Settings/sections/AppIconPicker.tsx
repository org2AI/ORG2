/**
 * Three-tile picker for the running app's Dock / taskbar icon.
 *
 * A radio group rather than a Select: the choice is visual, and the tile
 * itself is the only honest label — "Dark tile" says less than showing it.
 * Roving tabindex + arrow keys give it the keyboard contract of native
 * radios, with the previews being the same bundled PNGs Rust applies.
 */
import React, { useCallback } from "react";

import darkIcon from "@src/assets/appIcons/dark.png";
import lightIcon from "@src/assets/appIcons/light.png";
import rainbowIcon from "@src/assets/appIcons/rainbow.png";
import type { DockIconVariant } from "@src/hooks/settings";

const APP_ICON_PREVIEWS: Record<DockIconVariant, string> = {
  dark: darkIcon,
  light: lightIcon,
  rainbow: rainbowIcon,
};

export interface AppIconPickerOption {
  value: DockIconVariant;
  label: string;
}

interface AppIconPickerProps {
  value: DockIconVariant;
  options: readonly AppIconPickerOption[];
  onChange: (value: DockIconVariant) => void;
  ariaLabel: string;
  dataTestId?: string;
}

const TILE_BASE_CLASSES =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border bg-fill-1 p-0 transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:border-primary-6 focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)]";
const TILE_SELECTED_CLASSES =
  "border-primary-6 shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)]";
const TILE_IDLE_CLASSES = "border-border-2 hover:border-border-3";

export const AppIconPicker: React.FC<AppIconPickerProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  dataTestId,
}) => {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const step =
        event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      const index = options.findIndex((option) => option.value === value);
      const next = options[(index + step + options.length) % options.length];
      if (next) onChange(next.value);
    },
    [onChange, options, value]
  );

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex items-center gap-2"
      data-testid={dataTestId}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown}
            className={`${TILE_BASE_CLASSES} ${selected ? TILE_SELECTED_CLASSES : TILE_IDLE_CLASSES}`}
            data-testid={
              dataTestId ? `${dataTestId}-${option.value}` : undefined
            }
          >
            <img
              src={APP_ICON_PREVIEWS[option.value]}
              alt=""
              draggable={false}
              className="h-7 w-7 select-none"
            />
          </button>
        );
      })}
    </div>
  );
};
