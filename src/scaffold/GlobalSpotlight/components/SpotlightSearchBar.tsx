/**
 * SpotlightSearchBar Component
 *
 * Search bar with action/value pills and a contextual input placeholder.
 * Backspace removes segments.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { ArrowLeft01Icon, CleanIcon, HugeiconsIcon } from "@src/icons";

import { ICONS } from "../config";
import { SPOTLIGHT_CLASSES, SPOTLIGHT_TOKENS } from "../constants";
import type { PathSegment } from "../types";
import { handleSpotlightHorizontalArrow } from "./spotlightSearchKeyboard";

// ============ PROPS ============

interface SpotlightSearchBarProps {
  /** Compact spacing for embedded search cards. */
  density?: "default" | "compact";
  /** Ref for the input element */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Current search query */
  searchQuery: string;
  /** Handler for search query changes */
  onSearchQueryChange: (value: string) => void;
  /** Handler for keyboard events */
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Placeholder text */
  placeholder: string;
  /** Accessible name when the visible placeholder is insufficient. */
  ariaLabel?: string;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Whether countdown is active */
  isCountingDown?: boolean;
  /** The navigation path (breadcrumb) */
  path: PathSegment[];
  /** Handler to remove a specific segment */
  onRemoveSegment?: (index: number) => void;
  /** Whether to hide the close button on the action segment */
  hideActionClose?: boolean;
  /** Whether to hide the trailing text input after path pills */
  hideInput?: boolean;
  /** Shown inside the search row before the input, replacing path pills. */
  leadingSlot?: React.ReactNode;
  /** Shown inside the search row on the right */
  trailingSlot?: React.ReactNode;
}

// ============ COMPONENT ============

export const SpotlightSearchBar: React.FC<SpotlightSearchBarProps> = ({
  density = "default",
  inputRef,
  searchQuery,
  onSearchQueryChange,
  onKeyDown,
  placeholder,
  ariaLabel,
  isLoading: _isLoading = false,
  isCountingDown = false,
  path,
  onRemoveSegment,
  hideActionClose = false,
  hideInput = false,
  leadingSlot,
  trailingSlot,
}) => {
  const { t } = useTranslation();

  const compact = density === "compact";
  const inputFontSize = compact ? "text-xs" : SPOTLIGHT_TOKENS.inputFontSize;
  const hasPills = path.length > 0;
  const hasLeadingSlot = Boolean(leadingSlot);

  const getSegmentLabel = (segment: PathSegment): string => {
    const data = segment.data as
      | { labelKey?: string; pillLabelKey?: string }
      | undefined;
    if (data?.pillLabelKey) return t(data.pillLabelKey);
    if (data?.labelKey) return t(data.labelKey);
    return segment.label;
  };

  const handlePillRemove = (
    index: number,
    event?: React.MouseEvent<HTMLElement>
  ) => {
    event?.preventDefault();
    event?.stopPropagation();
    onRemoveSegment?.(index);
  };

  const handleResetSearch = () => {
    onSearchQueryChange("");
    inputRef.current?.focus();
  };

  const renderBackChevron = () => (
    <HugeiconsIcon
      icon={ArrowLeft01Icon}
      data-icon="chevron-left"
      size={13}
      strokeWidth={2.5}
      className="block shrink-0 self-center"
    />
  );

  // AnyIcon resolves every shape a segment can carry: `""` (deliberate
  // no-icon), a brand-mark component (including forwardRef/memo wrappers,
  // which `typeof === "function"` misses), and hugeicons glyph data — which a
  // hand-rolled switch here used to drop entirely, leaving pills iconless.
  const renderPillIcon = (segment: PathSegment) => (
    <AnyIcon
      icon={segment.icon}
      size={14}
      className="block shrink-0 self-center text-primary-6"
    />
  );

  return (
    <div>
      <div
        className={`spotlight-search-bar flex items-center ${compact ? "h-10 min-h-10 gap-1.5 pr-2 pl-3" : "h-[56px] min-h-[56px] gap-2 px-4"}`}
      >
        {hasLeadingSlot ? (
          <div className="flex shrink-0 items-center">{leadingSlot}</div>
        ) : !hasPills ? (
          <div
            className={`flex shrink-0 items-center justify-center ${compact ? "h-5 w-5" : "h-6 w-6"}`}
          >
            <AnyIcon
              icon={ICONS.search}
              size={SPOTLIGHT_TOKENS.iconSize}
              className="text-text-2"
              data-icon="search"
            />
          </div>
        ) : null}

        {!hasLeadingSlot && hasPills && (
          <div
            className={`flex min-w-0 shrink-0 items-center gap-2 ${inputFontSize} text-text-1`}
          >
            {path.map((segment, index) => {
              const canRemove =
                !!onRemoveSegment &&
                (segment.type !== "action" || !hideActionClose);
              const label = getSegmentLabel(segment);
              const Pill = canRemove ? "button" : "div";
              return (
                <Pill
                  type={canRemove ? "button" : undefined}
                  key={`${segment.type}-${segment.id}`}
                  className={`${SPOTLIGHT_CLASSES.primaryPill} ${canRemove ? SPOTLIGHT_CLASSES.interactivePill : ""}`}
                  onClick={
                    canRemove
                      ? (event) => handlePillRemove(index, event)
                      : undefined
                  }
                  title={label}
                >
                  {canRemove && !isCountingDown && renderBackChevron()}
                  {!canRemove && renderPillIcon(segment)}
                  <span className={`max-w-[220px] truncate ${inputFontSize}`}>
                    {label}
                  </span>
                </Pill>
              );
            })}
          </div>
        )}

        {!hideInput && (
          <Input
            appearance="bare"
            size="small"
            autoHeight
            className={`min-w-0 flex-1 [&>.input-inner]:border-0! ${inputFontSize}`}
            inputStyle={{ fontSize: "inherit", lineHeight: "inherit" }}
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(_value, event) =>
              onSearchQueryChange(event.target.value)
            }
            onKeyDown={(event) => {
              if (!handleSpotlightHorizontalArrow(event)) onKeyDown(event);
            }}
            placeholder={placeholder}
            aria-label={ariaLabel}
            inputClassName={`min-w-0 flex-1 bg-transparent text-ellipsis ${inputFontSize} text-text-1 placeholder:text-text-1 focus:outline-none`}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-spotlight-input="true"
          />
        )}

        {(trailingSlot || (!hideInput && searchQuery && !isCountingDown)) && (
          <div
            className={`flex shrink-0 items-center gap-px ${hideInput ? "ml-auto" : ""}`}
          >
            {!hideInput && searchQuery && !isCountingDown && (
              <ToolbarTooltip label={t("common:actions.clear")}>
                <Button
                  variant="tertiary"
                  size="small"
                  iconOnly
                  onClick={handleResetSearch}
                  icon={
                    <>
                      <HugeiconsIcon icon={CleanIcon} size={14} />
                      <span className="sr-only">
                        {t("common:actions.clear")}
                      </span>
                    </>
                  }
                />
              </ToolbarTooltip>
            )}

            {trailingSlot ? (
              <div className="flex shrink-0 items-center">{trailingSlot}</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
