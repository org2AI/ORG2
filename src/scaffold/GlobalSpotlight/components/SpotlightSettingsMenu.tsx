/**
 * SpotlightSettingsMenu
 *
 * "…" button at the end of the keyboard-hint pill. Opens a small menu with
 * Spotlight's own view preferences — placement, background dim, hover detail
 * card — and, for a surface that supports pinning, an "Unpin all" action that
 * clears only that surface's pin list (`pinScope`).
 *
 * The menu portals to <body> at DROPDOWN_PANEL.zIndex, which sits above the
 * Spotlight container. ActionMenuSurface owns Escape (capture phase), so
 * Escape closes this menu without also closing Spotlight.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { ActionMenuSurface } from "@src/components/Dropdown/ActionMenuSurface";
import DropdownActionItem from "@src/components/Dropdown/DropdownActionItem";
import {
  MenuSegmentedRow,
  MenuSwitchRow,
} from "@src/components/Dropdown/MenuControlRows";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import {
  SPOTLIGHT_PLACEMENT_OPTIONS,
  localizeMenuOptions,
} from "@src/config/appearance/quickMenuOptions";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useSetting } from "@src/hooks/settings/useSettings";
import { EllipsisIcon, HugeiconsIcon, PinOffIcon } from "@src/icons";
import {
  type SpotlightPinScope,
  spotlightPinAtoms,
} from "@src/store/ui/spotlightPinsAtom";
import {
  type SpotlightPlacement,
  spotlightPlacementAtom,
} from "@src/store/ui/uiAtom";

/** The trigger is a round button inside the footer pill, so the shared 4px
 *  trigger gap reads as the panel touching the pill. */
const MENU_TRIGGER_GAP = 8;

const UnpinAllItem: React.FC<{
  scope: SpotlightPinScope;
  onDone: () => void;
}> = ({ scope, onDone }) => {
  const { t } = useTranslation();
  const atom = spotlightPinAtoms[scope];
  const pinCount = useAtomValue(atom).length;
  const setPins = useSetAtom(atom);
  return (
    <>
      <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
      <DropdownActionItem
        icon={
          <HugeiconsIcon
            icon={PinOffIcon}
            data-icon="pin-off"
            size={DROPDOWN_ITEM.iconSize}
          />
        }
        disabled={pinCount === 0}
        onClick={() => {
          setPins([]);
          onDone();
        }}
      >
        {t("selectors.spotlightFooter.unpinAll")}
      </DropdownActionItem>
    </>
  );
};

export const SpotlightSettingsMenu: React.FC<{
  /** Pin list owned by the open surface; omit when it has no pins. */
  pinScope?: SpotlightPinScope;
}> = ({ pinScope }) => {
  const { t } = useTranslation();
  const { t: tSettings } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const { isPositioned, triggerRef, panelRef, panelPosition, toggle, close } =
    useDropdownEngine<HTMLSpanElement>({
      open,
      onOpenChange: setOpen,
      placement: "auto",
      align: "right",
      gap: MENU_TRIGGER_GAP,
      autoKeyboardNavigation: false,
      closeOnEsc: false,
    });

  const [placement, setPlacement] = useAtom(spotlightPlacementAtom);
  const [dimBackground, setDimBackground] = useSetting(
    "general.spotlightDimBackground"
  );
  const [detailCard, setDetailCard] = useSetting("general.spotlightDetailCard");
  const label = t("selectors.spotlightFooter.settings");

  return (
    // Clicks must not reach the footer's refocus-input handler, which would
    // pull focus out of the open menu.
    <span
      className="flex items-center gap-2"
      onClick={(event) => event.stopPropagation()}
    >
      <span aria-hidden className="h-3 w-px shrink-0 bg-border-2" />
      <span ref={triggerRef} className="-my-1.5 -mr-3 inline-flex">
        <Button
          variant="tertiary"
          size="small"
          shape="round"
          iconOnly
          icon={
            <HugeiconsIcon icon={EllipsisIcon} data-icon="ellipsis" size={14} />
          }
          onClick={toggle}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          title={label}
          className={`shrink-0 hover:bg-fill-2 hover:text-text-1 ${
            open ? "bg-fill-2 text-text-1" : ""
          }`}
          data-testid="spotlight-settings-button"
        />
      </span>
      {open &&
        isPositioned &&
        createPortal(
          <ActionMenuSurface
            panelRef={panelRef}
            onClose={close}
            aria-label={label}
            data-testid="spotlight-settings-menu"
            className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.panelWidthClass}`}
            style={{
              position: "fixed",
              top: panelPosition.top,
              bottom: panelPosition.bottom,
              right: panelPosition.right,
              maxHeight: panelPosition.maxHeight,
              overflowY: "auto",
              zIndex: DROPDOWN_PANEL.zIndex,
            }}
          >
            <MenuSegmentedRow<SpotlightPlacement>
              label={tSettings("general.spotlightPlacement")}
              value={placement}
              options={localizeMenuOptions(
                SPOTLIGHT_PLACEMENT_OPTIONS,
                tSettings
              )}
              onChange={setPlacement}
            />
            <MenuSwitchRow
              label={tSettings("general.spotlightDimBackground")}
              checked={dimBackground}
              onCheckedChange={setDimBackground}
            />
            <MenuSwitchRow
              label={tSettings("general.spotlightDetailCard")}
              checked={detailCard}
              onCheckedChange={setDetailCard}
            />
            {pinScope && <UnpinAllItem scope={pinScope} onDone={close} />}
          </ActionMenuSurface>,
          document.body
        )}
    </span>
  );
};

export default SpotlightSettingsMenu;
