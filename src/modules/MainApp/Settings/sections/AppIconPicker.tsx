/** Three-option pill for the running app's Dock / taskbar icon. */
import React from "react";

import darkIcon from "@src/assets/appIcons/dark.png";
import lightIcon from "@src/assets/appIcons/light.png";
import rainbowIcon from "@src/assets/appIcons/rainbow.png";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
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

export const AppIconPicker: React.FC<AppIconPickerProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  dataTestId,
}) => (
  <SegmentedTextPill<DockIconVariant>
    ariaLabel={ariaLabel}
    value={value}
    onChange={onChange}
    size="large"
    dataTestId={dataTestId}
    options={options.map((option) => ({
      value: option.value,
      ariaLabel: option.label,
      tooltip: option.label,
      label: (
        <span
          className="inline-flex items-center justify-center"
          data-testid={dataTestId ? `${dataTestId}-${option.value}` : undefined}
        >
          <img
            src={APP_ICON_PREVIEWS[option.value]}
            alt=""
            draggable={false}
            className="h-5 w-5 select-none"
          />
        </span>
      ),
    }))}
  />
);
