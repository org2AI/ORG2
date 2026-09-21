import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { PILL_CONTROL_HOVER_CLASS } from "@src/components/CompoundPill/config";
import {
  ActionMenuSurface,
  ActionSubmenu,
} from "@src/components/Dropdown/ActionMenuSurface";
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import EffortSlider from "@src/components/ModelPropertiesDropdown/EffortSlider";
import Tooltip from "@src/components/Tooltip";
import { useDropdownEngine } from "@src/hooks/dropdown";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FlashIcon,
  HugeiconsIcon,
  Search01Icon,
  Tick01Icon,
} from "@src/icons";
import {
  MODEL_REASONING_LEVEL,
  type ModelReasoningLevel,
  formatReasoningLevel,
} from "@src/util/modelVariants";
import type {
  VariantEditOptions,
  VariantSelection,
} from "@src/util/variantEditOptions";

/**
 * Glyph size for the compact panel's two 28px controls. `DROPDOWN_ITEM.iconSize`
 * (13px) is sized for 32px dropdown rows and reads undersized here.
 */
const COMPACT_ACTION_ICON_SIZE = 16;

export interface HarnessSwitchAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export interface ModelSettingsMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  modelLabel: string;
  value?: string;
  harnessSwitch?: HarnessSwitchAction;
  showVariantControls?: boolean;
  variantOptions: VariantEditOptions;
  onModelClick: () => void;
  onChange: (modelId: string) => void;
  /** Reports open/close so a host segment can hold its active styling. */
  onOpenChange?: (open: boolean) => void;
  /** Open the detailed Effort/Speed rows instead of the compact slider. */
  defaultAdvanced?: boolean;
  className?: string;
  renderTrigger: (props: {
    open: boolean;
    onClick: React.MouseEventHandler<HTMLButtonElement>;
    /** Level under the slider thumb mid-drag, before it is committed. The
     *  trigger renders it so the pill reports the level being chosen. */
    previewLevel?: ModelReasoningLevel;
  }) => React.ReactNode;
}

/** One menu for the combined model pill; callers still own every saved value. */
export default function ModelSettingsMenu({
  anchorRef,
  modelLabel,
  value = "",
  harnessSwitch,
  showVariantControls = true,
  variantOptions,
  onModelClick,
  onChange,
  onOpenChange,
  defaultAdvanced = false,
  className = "",
  renderTrigger,
}: ModelSettingsMenuProps) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(defaultAdvanced);
  const [previewLevel, setPreviewLevel] = useState<ModelReasoningLevel>();
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    isOpen,
    isPositioned,
    panelRef,
    panelPosition,
    toggle,
    close: closeDropdown,
  } = useDropdownEngine<HTMLButtonElement>({
    anchorRef,
    align: "left",
    placement: "auto",
    captureKeyboardFocus: true,
    autoKeyboardNavigation: false,
    closeOnEsc: false,
  });
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);
  const selection = variantOptions.parseSelection(value);
  const levels = variantOptions.availableLevels;
  const effortLabel = selection.level
    ? formatReasoningLevel(selection.level)
    : "";
  const text = (key: string) => t(`selectors.modelProperties.${key}`);
  const speedLabel = text(selection.fast ? "fast" : "standard");
  const resolve = (next: VariantSelection) =>
    variantOptions.resolveVariantId({
      ...next,
      fast: next.fast && variantOptions.fastAvailable(next),
    });
  const change = (next: VariantSelection) => {
    const modelId = resolve(next);
    if (modelId && modelId !== value) onChange(modelId);
  };
  const close = () => {
    closeDropdown();
    setAdvanced(defaultAdvanced);
    setPreviewLevel(undefined);
    anchorRef.current?.focus({ preventScroll: true });
  };
  const showAdvanced = (next: boolean) => {
    // The outer panel stays mounted so positioning and focus capture keep the
    // same owner while the compact slider and detailed menu exchange places.
    panelRef.current?.focus({ preventScroll: true });
    // The slider unmounts with the compact view, so it never gets to report
    // the end of an in-flight gesture. Drop the preview here instead.
    setPreviewLevel(undefined);
    setAdvanced(next);
  };
  const choice = (
    key: string,
    label: string,
    next: VariantSelection,
    checked: boolean,
    disabled = false,
    purple = false
  ) => (
    <DropdownItem
      key={key}
      role="menuitemradio"
      ariaChecked={checked}
      ariaLabel={label}
      tabIndex={0}
      fullWidth
      selected={checked}
      disabled={disabled || !resolve(next)}
      onClick={() => change(next)}
      dataTestId={`model-settings-${key}`}
      suffix={
        checked && purple ? (
          <HugeiconsIcon
            icon={Tick01Icon}
            size={DROPDOWN_ITEM.iconSize}
            className="text-purple-6"
          />
        ) : undefined
      }
    >
      <span className={purple ? "text-purple-6" : undefined}>{label}</span>
    </DropdownItem>
  );

  const harnessButton = harnessSwitch ? (
    <Tooltip
      content={t("sessions:creator.switchAgent")}
      position="top"
      framedPanel
      kind="button"
    >
      <Button
        variant="tertiary"
        size="small"
        className="w-max shrink-0 px-1.5!"
        style={{ fontSize: "var(--dropdown-font-size, 13px)" }}
        icon={
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={COMPACT_ACTION_ICON_SIZE}
          />
        }
        iconPosition="right"
        disabled={harnessSwitch.disabled}
        aria-label={`${t("sessions:creator.switchAgent")}: ${harnessSwitch.label}`}
        data-testid="model-selector-switch-harness"
        onClick={() => {
          closeDropdown();
          harnessSwitch.onClick();
        }}
      >
        <span className="flex items-center gap-1.5 leading-none">
          {harnessSwitch.icon && (
            <span
              aria-hidden="true"
              className="flex size-3.5 shrink-0 items-center justify-center leading-none [&>svg]:block"
            >
              {harnessSwitch.icon}
            </span>
          )}
          <span>{harnessSwitch.label}</span>
        </span>
      </Button>
    </Tooltip>
  ) : null;

  return (
    <>
      {renderTrigger({
        open: isOpen,
        previewLevel: isOpen ? previewLevel : undefined,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        },
      })}
      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
            aria-label={text("settings")}
            className={`w-max min-w-[250px] ${className}`}
            style={{
              position: "fixed",
              top: panelPosition.top,
              bottom: panelPosition.bottom,
              left: panelPosition.left,
              zIndex: DROPDOWN_PANEL.zIndex,
              visibility: isPositioned ? "visible" : "hidden",
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (
                (!advanced || !showVariantControls) &&
                event.key === "Escape"
              ) {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          >
            {advanced && showVariantControls ? (
              <ActionMenuSurface
                panelRef={menuRef}
                onClose={close}
                fitSubmenus
                aria-label={text("settings")}
                className={DROPDOWN_CLASSES.menuPanelBase}
              >
                {harnessButton}
                <DropdownItem
                  role="menuitem"
                  tabIndex={0}
                  fullWidth
                  ariaLabel={text("model")}
                  dataTestId="model-settings-model"
                  onClick={() => {
                    closeDropdown();
                    onModelClick();
                  }}
                  suffix={
                    <span className="inline-flex items-center gap-2">
                      <span>{modelLabel}</span>
                      {/* Search, not a chevron: this row dismisses the menu
                          for the spotlight model picker instead of opening a
                          flyout the way every ActionSubmenu row below does. */}
                      <HugeiconsIcon
                        icon={Search01Icon}
                        data-icon="search"
                        size={DROPDOWN_ITEM.iconSize}
                      />
                    </span>
                  }
                >
                  {text("model")}
                </DropdownItem>
                <ActionSubmenu
                  label={text("effort")}
                  value={
                    <span
                      className={
                        selection.level === MODEL_REASONING_LEVEL.ULTRA
                          ? "text-purple-6"
                          : ""
                      }
                    >
                      {effortLabel}
                    </span>
                  }
                  icon={null}
                  dataTestId="model-settings-effort"
                >
                  {levels.map((level) =>
                    choice(
                      `effort-${level}`,
                      formatReasoningLevel(level),
                      { ...selection, level },
                      level === selection.level,
                      false,
                      level === MODEL_REASONING_LEVEL.ULTRA
                    )
                  )}
                </ActionSubmenu>
                {showVariantControls &&
                  variantOptions.fastAvailableAnywhere && (
                    <ActionSubmenu
                      label={text("speed")}
                      value={speedLabel}
                      icon={null}
                      dataTestId="model-settings-speed"
                    >
                      {choice(
                        "speed-standard",
                        text("standard"),
                        { ...selection, fast: false },
                        !selection.fast
                      )}
                      {choice(
                        "speed-fast",
                        text("fast"),
                        { ...selection, fast: true },
                        selection.fast,
                        !variantOptions.fastAvailable(selection)
                      )}
                    </ActionSubmenu>
                  )}
                {variantOptions.thinkingToggleable && (
                  <ActionSubmenu
                    label={text("thinking")}
                    value={text(selection.thinking ? "on" : "off")}
                    icon={null}
                    dataTestId="model-settings-thinking"
                  >
                    {choice(
                      "thinking-off",
                      text("off"),
                      { ...selection, thinking: false },
                      !selection.thinking
                    )}
                    {choice(
                      "thinking-on",
                      text("on"),
                      { ...selection, thinking: true },
                      selection.thinking
                    )}
                  </ActionSubmenu>
                )}
                <div className="mt-1 border-t border-border-2 pt-1">
                  <DropdownItem
                    role="menuitem"
                    tabIndex={0}
                    fullWidth
                    ariaExpanded={advanced}
                    dataTestId="model-settings-advanced"
                    onClick={() => showAdvanced(false)}
                    icon={
                      <HugeiconsIcon
                        icon={ArrowLeft01Icon}
                        size={DROPDOWN_ITEM.iconSize}
                      />
                    }
                  >
                    {t("actions.back")}
                  </DropdownItem>
                </div>
              </ActionMenuSurface>
            ) : (
              <div className={`${DROPDOWN_CLASSES.menuPanelBase} px-2 py-1`}>
                <div className="flex items-center justify-start gap-1">
                  <Button
                    size="small"
                    variant="tertiary"
                    className="w-max shrink-0 px-1.5!"
                    style={{ fontSize: "var(--dropdown-font-size, 13px)" }}
                    icon={
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        size={COMPACT_ACTION_ICON_SIZE}
                      />
                    }
                    iconPosition="right"
                    data-testid="model-settings-switch-model"
                    onClick={() => {
                      closeDropdown();
                      onModelClick();
                    }}
                  >
                    {t("sessions:creator.switchModel")}
                  </Button>
                  {harnessButton && (
                    <>
                      <span
                        aria-hidden="true"
                        className="h-3 w-px shrink-0 bg-border-2"
                      />
                      {harnessButton}
                    </>
                  )}
                  {showVariantControls &&
                    variantOptions.fastAvailableAnywhere && (
                      <Tooltip
                        content={`${text("speed")}: ${speedLabel}`}
                        position="top"
                        framedPanel
                        kind="button"
                      >
                        <Button
                          variant="tertiary"
                          size="small"
                          className={`ml-auto shrink-0 rounded-lg ${PILL_CONTROL_HOVER_CLASS}`}
                          aria-label={text("fast")}
                          aria-pressed={selection.fast}
                          disabled={!variantOptions.fastAvailable(selection)}
                          data-testid="model-settings-fast-toggle"
                          onClick={() =>
                            change({ ...selection, fast: !selection.fast })
                          }
                          iconOnly
                          icon={
                            <HugeiconsIcon
                              icon={FlashIcon}
                              data-icon="fast"
                              size={COMPACT_ACTION_ICON_SIZE}
                              // Solid bolt while Fast is on. FlashIcon's path is an
                              // outline with no fill of its own, so it inherits the
                              // svg fill; dropping the stroke keeps the silhouette
                              // clean instead of a filled shape with a heavy edge.
                              fill={selection.fast ? "currentColor" : "none"}
                              strokeWidth={selection.fast ? 0 : undefined}
                            />
                          }
                        />
                      </Tooltip>
                    )}
                </div>
                {showVariantControls && variantOptions.thinkingToggleable && (
                  <Button
                    variant="tertiary"
                    size="small"
                    aria-pressed={selection.thinking}
                    style={{ fontSize: "var(--dropdown-font-size, 13px)" }}
                    data-testid="model-settings-thinking-toggle"
                    onClick={() =>
                      change({ ...selection, thinking: !selection.thinking })
                    }
                  >
                    {text("thinking")}:{" "}
                    {text(selection.thinking ? "on" : "off")}
                  </Button>
                )}
                {showVariantControls && levels.length > 1 && (
                  <EffortSlider
                    levels={levels}
                    value={selection.level}
                    onChange={(level) => change({ ...selection, level })}
                    onPreviewChange={setPreviewLevel}
                    fast={selection.fast}
                    animate={isPositioned}
                    showLabel={false}
                  />
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
