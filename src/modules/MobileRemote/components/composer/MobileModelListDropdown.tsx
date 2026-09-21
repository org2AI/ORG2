import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Button from "@src/components/Button";
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import DropdownPanel from "@src/components/Dropdown/DropdownPanel";
import DropdownSearch from "@src/components/Dropdown/DropdownSearch";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import ModelIcon from "@src/components/ModelIcon";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useFilteredItems } from "@src/hooks/search";
import type { MobileModelOption } from "@src/modules/MobileRemote/connection/types";
import { useMobileRemotePlatform } from "@src/modules/MobileRemote/platform";
import { formatModelName } from "@src/util/formatModelName";

import { mobileModelOptionsShareFamily } from "./collapseMobileModelOptions";
import "./mobileComposerResponsive.scss";

function formatModelLabel(modelId: string): string {
  return formatModelName(modelId) || modelId;
}

export interface MobileModelListDropdownProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  options: MobileModelOption[];
  /** Full catalog used for family matching on the current selection. */
  allOptions?: MobileModelOption[];
  currentModelId?: string;
  currentAccountId?: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  retryLabel?: string;
  patching?: boolean;
  loadingLabel: string;
  emptyLabel: string;
  onSelect: (option: MobileModelOption) => void;
}

/** Anchored model list — same dropdown chrome as desktop UnifiedModelDropdown. */
export function MobileModelListDropdown({
  anchorRef,
  open,
  onClose,
  options,
  allOptions,
  currentModelId,
  currentAccountId,
  loading = false,
  error,
  onRetry,
  retryLabel,
  patching = false,
  loadingLabel,
  emptyLabel,
  onSelect,
}: MobileModelListDropdownProps) {
  const platform = useMobileRemotePlatform();
  const portalContainer = platform.runtime.portalContainer();
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const familyOptions = allOptions ?? options;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setSearchQuery(""));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const getSearchText = useCallback(
    (option: MobileModelOption) =>
      `${formatModelLabel(option.id)} ${option.accountLabel} ${option.id}`,
    []
  );
  const { filteredItems } = useFilteredItems({
    items: options,
    searchQuery,
    getSearchText,
  });

  const handleSelect = useCallback(
    (option: MobileModelOption) => {
      if (patching) return;
      onSelect(option);
    },
    [onSelect, patching]
  );

  const { isPositioned, panelRef, panelPosition, keyboard } = useDropdownEngine<
    HTMLElement,
    MobileModelOption
  >({
    anchorRef,
    open,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onClose();
    },
    placement: "auto",
    gap: DROPDOWN_PANEL.triggerGap,
    listNavigation: {
      items: filteredItems,
      onSelect: handleSelect,
      initialSelectedIndex: -1,
    },
  });

  useEffect(() => {
    if (!open || !isPositioned) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isPositioned, open]);

  // Mount hidden while positioning so the shared engine can measure the panel
  // on its first pass and attach its existing resize observer to real content.
  if (!open || !portalContainer) return null;

  return createPortal(
    <DropdownPanel
      ref={panelRef}
      role="listbox"
      aria-label={loadingLabel}
      data-testid="mobile-model-picker-dropdown"
      className="mobile-model-menu fixed flex flex-col overflow-hidden p-1"
      style={{
        top: panelPosition.top,
        bottom: panelPosition.bottom,
        left: panelPosition.left,
        maxHeight: panelPosition.maxHeight,
        visibility: isPositioned ? "visible" : "hidden",
      }}
    >
      <DropdownSearch
        ref={inputRef}
        value={searchQuery}
        onChange={setSearchQuery}
        containerClassName="mb-1"
        autoFocus
      />
      <div
        className={`${DROPDOWN_CLASSES.optionsContainerOverlay} min-h-0 flex-1`}
        style={{ maxHeight: panelPosition.maxHeight }}
      >
        {error ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            <p role="alert">{error}</p>
            {onRetry && (
              <Button size="small" onClick={onRetry} disabled={loading}>
                {retryLabel}
              </Button>
            )}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            {loading ? loadingLabel : emptyLabel}
          </div>
        ) : (
          filteredItems.map((option, index) => {
            const selected =
              option.id === currentModelId &&
              option.accountId === (currentAccountId ?? "");
            const selectedByFamily =
              !selected &&
              Boolean(currentModelId) &&
              option.accountId === (currentAccountId ?? "") &&
              mobileModelOptionsShareFamily(
                familyOptions,
                currentModelId ?? "",
                option.id
              );
            const showSelected = selected || selectedByFamily;
            const label = formatModelLabel(option.id);
            const navigation = keyboard.getItemProps(index);
            return (
              <DropdownItem
                key={`${option.accountId}:${option.id}`}
                disabled={patching}
                dataDropdownItemIndex={index}
                onClick={navigation.onClick}
                onMouseEnter={navigation.onMouseEnter}
                highlighted={
                  navigation["data-dropdown-keyboard-highlight"] === "true"
                }
                selected={showSelected}
                selectedCheckPlacement="icon"
                fullWidth
                className="min-h-11"
                icon={<ModelIcon modelName={option.id} size={14} />}
              >
                <span className="mobile-model-menu__label">
                  <span>{label}</span>
                  <span className="mobile-type-caption text-text-3">
                    {option.accountLabel}
                  </span>
                </span>
              </DropdownItem>
            );
          })
        )}
      </div>
    </DropdownPanel>,
    portalContainer
  );
}

MobileModelListDropdown.displayName = "MobileModelListDropdown";
