import React, { memo, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { DropdownPanel } from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import SplitButton from "@src/components/SplitButton";
import { SPLIT_BUTTON } from "@src/config/workstation/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useAvailableShells } from "@src/hooks/terminal";
import { Add01Icon, ArrowDown01Icon, HugeiconsIcon } from "@src/icons";
import type { ShellProfile } from "@src/types/terminal";

const SIDEBAR_ICON_STROKE_WIDTH = 2.25;

export interface NewTerminalSessionOptions {
  shell?: string;
  args?: string[];
  name?: string;
  profileId?: string;
}

interface TerminalNewSessionSplitButtonProps {
  onNewTerminal: (options?: NewTerminalSessionOptions) => void;
  density?: "header" | "sidebar";
  splitMainWidth?: number;
}

const TerminalNewSessionSplitButtonComponent: React.FC<
  TerminalNewSessionSplitButtonProps
> = ({ onNewTerminal, density = "header", splitMainWidth }) => {
  const { t } = useTranslation("common");
  const { profiles: shellProfiles } = useAvailableShells();

  const {
    isOpen: isShellPickerOpen,
    isPositioned: isShellPickerPositioned,
    toggle: toggleShellPicker,
    close: closeShellPicker,
    triggerRef: shellPickerTriggerRef,
    panelRef: shellPickerDropdownRef,
    panelPosition: shellPickerPosition,
  } = useDropdownEngine<HTMLButtonElement>({
    gap: 4,
    align: "right",
    placement: "bottom",
  });

  const handlePickProfile = useCallback(
    (profile: ShellProfile) => {
      closeShellPicker();
      onNewTerminal({
        shell: profile.path,
        args: profile.args,
        name: profile.name,
        profileId: profile.id,
      });
    },
    [closeShellPicker, onNewTerminal]
  );

  const terminalTitle = t("controlTower.sidebar.newTerminal", "New Terminal");
  const hasProfilePicker = shellProfiles.length > 1;

  const shellPickerMenu = useMemo(() => {
    if (!isShellPickerOpen || !isShellPickerPositioned) return null;

    return createPortal(
      <DropdownPanel
        ref={shellPickerDropdownRef}
        className={DROPDOWN_WIDTHS.sidebarMenuClass}
        animated={false}
        maxHeight="none"
        style={{
          position: "fixed",
          top: shellPickerPosition.top,
          right: shellPickerPosition.right,
          zIndex: 9999,
        }}
      >
        <div className={DROPDOWN_CLASSES.optionsContainer}>
          {shellProfiles
            .filter((profile) => profile.category === "shell")
            .map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left`}
                onClick={() => handlePickProfile(profile)}
              >
                <span className="flex-1 truncate">{profile.name}</span>
                {profile.isDefault && (
                  <span className="text-xs text-text-3">
                    {t("common:common.default", "Default")}
                  </span>
                )}
              </button>
            ))}
          {shellProfiles.some((profile) => profile.category === "repl") && (
            <>
              <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
              {shellProfiles
                .filter((profile) => profile.category === "repl")
                .map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left`}
                    onClick={() => handlePickProfile(profile)}
                  >
                    <span className="flex-1 truncate">{profile.name}</span>
                  </button>
                ))}
            </>
          )}
        </div>
      </DropdownPanel>,
      document.body
    );
  }, [
    handlePickProfile,
    isShellPickerOpen,
    isShellPickerPositioned,
    shellPickerDropdownRef,
    shellPickerPosition,
    shellProfiles,
    t,
  ]);

  if (density === "sidebar") {
    if (!hasProfilePicker) {
      return (
        <Button
          htmlType="button"
          onClick={(event) => {
            event.stopPropagation();
            onNewTerminal();
          }}
          title={terminalTitle}
          size="sidebar"
          variant="tertiary"
          appearance="soft"
          iconOnly
          icon={
            <HugeiconsIcon
              icon={Add01Icon}
              data-icon="plus"
              size={DROPDOWN_ITEM.iconSize}
              strokeWidth={SIDEBAR_ICON_STROKE_WIDTH}
            />
          }
        />
      );
    }

    return (
      <div
        className={`${SPLIT_BUTTON.container} ${isShellPickerOpen ? "bg-fill-2" : ""}`}
      >
        <button
          type="button"
          className={`${SPLIT_BUTTON.left} ${isShellPickerOpen ? "text-text-1" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onNewTerminal();
          }}
          title={terminalTitle}
        >
          <HugeiconsIcon
            icon={Add01Icon}
            data-icon="plus"
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={SIDEBAR_ICON_STROKE_WIDTH}
          />
        </button>
        <button
          ref={shellPickerTriggerRef}
          type="button"
          className={`${SPLIT_BUTTON.right} ${isShellPickerOpen ? "bg-fill-3 text-text-1" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleShellPicker();
          }}
          title={terminalTitle}
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            data-icon="chevron-down"
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={SIDEBAR_ICON_STROKE_WIDTH}
          />
        </button>
        {shellPickerMenu}
      </div>
    );
  }

  if (!hasProfilePicker) {
    return (
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        onClick={(event) => {
          event.stopPropagation();
          onNewTerminal();
        }}
        title={terminalTitle}
        icon={
          <HugeiconsIcon
            icon={Add01Icon}
            data-icon="plus"
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={2}
          />
        }
      />
    );
  }

  return (
    <SplitButton
      ref={shellPickerTriggerRef}
      htmlType="button"
      variant="tertiary"
      size="small"
      iconOnly
      className={isShellPickerOpen ? "bg-fill-2! text-primary-6!" : ""}
      onClick={(event) => {
        event.stopPropagation();
        onNewTerminal();
      }}
      aria-label={terminalTitle}
      title={terminalTitle}
      icon={
        <HugeiconsIcon
          icon={Add01Icon}
          data-icon="plus"
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={2}
        />
      }
      menu={shellPickerMenu ?? <div />}
      onMenuButtonClick={(event) => {
        event.stopPropagation();
        toggleShellPicker();
      }}
      menuOpen={isShellPickerOpen}
      menuButtonLabel={terminalTitle}
      mainSegmentWidth={splitMainWidth}
    />
  );
};

export const TerminalNewSessionSplitButton = memo(
  TerminalNewSessionSplitButtonComponent
);
TerminalNewSessionSplitButton.displayName = "TerminalNewSessionSplitButton";
