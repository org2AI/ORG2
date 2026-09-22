/**
 * Shared Spotlight Input Component
 *
 * Reusable search input for spotlight interfaces
 */
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import {
  Cancel01Icon,
  HugeiconsIcon,
  type IconSvgElement,
  Search01Icon,
} from "@src/icons";

import { SPOTLIGHT_TOKENS } from "../constants";

interface SpotlightInputProps {
  /** Input ref for focus management */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Current search value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Accessible name when the visible placeholder is insufficient. */
  ariaLabel?: string;
  /** Keydown handler */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Static glyph to display (defaults to Search); use `iconElement` for arbitrary JSX */
  icon?: IconSvgElement;
  /** Custom icon element (overrides icon prop) */
  iconElement?: React.ReactNode;
  /** Renders at the end of the search row (e.g. mode badge); stays in the 56px bar */
  trailingSlot?: React.ReactNode;
  /** Auto focus on mount */
  autoFocus?: boolean;
}

export const SpotlightInput: React.FC<SpotlightInputProps> = ({
  inputRef,
  value,
  onChange,
  ariaLabel,
  onKeyDown,
  placeholder = "Search...",
  icon: IconComponent = Search01Icon,
  iconElement,
  trailingSlot,
  autoFocus = true,
}) => {
  const { t } = useTranslation();
  const tauriSelectAll = useTauriSelectAllShortcut();

  const handleResetSearch = () => {
    onChange("");
    inputRef?.current?.focus();
  };

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      tauriSelectAll(event);
    },
    [onKeyDown, tauriSelectAll]
  );

  return (
    <div>
      <div className="flex h-[56px] min-h-[56px] items-center gap-2 px-4">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center">
          {iconElement ? (
            iconElement
          ) : (
            <HugeiconsIcon
              icon={IconComponent}
              size={SPOTLIGHT_TOKENS.iconSize}
              className="text-text-2"
            />
          )}
        </div>

        <Input
          appearance="bare"
          size="small"
          autoHeight
          className={`min-w-0 flex-1 [&>.input-inner]:border-0! ${SPOTLIGHT_TOKENS.inputFontSize}`}
          inputStyle={{ fontSize: "inherit", lineHeight: "inherit" }}
          ref={inputRef}
          type="text"
          value={value}
          onChange={(_value, event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          inputClassName={`min-w-0 flex-1 bg-transparent ${SPOTLIGHT_TOKENS.inputFontSize} text-text-1 outline-none placeholder:text-text-2`}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck="false"
          data-spotlight-input="true"
          data-action="file.open"
        />

        {trailingSlot ? (
          <div className="flex shrink-0 items-center">{trailingSlot}</div>
        ) : null}

        {value ? (
          <Button
            variant="tertiary"
            size="small"
            shape="round"
            iconOnly
            icon={<HugeiconsIcon icon={Cancel01Icon} data-icon="x" size={14} />}
            className="shrink-0 hover:bg-fill-2 hover:text-text-1"
            aria-label={t("common:tooltips.clearSearch")}
            onClick={handleResetSearch}
          />
        ) : null}
      </div>
    </div>
  );
};
