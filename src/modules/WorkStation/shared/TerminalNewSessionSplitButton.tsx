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
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useAvailableShells } from "@src/hooks/terminal";
import { Add01Icon, HugeiconsIcon } from "@src/icons";
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

  const terminalTitle = t("controlTower.sidebar.newTerminal");
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
              <Button
                layout="custom"
                key={profile.id}
                className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left`}
                onClick={() => handlePickProfile(profile)}
              >
                <span className="flex-1 truncate">{profile.name}</span>
                {profile.isDefault && (
                  <span className="text-xs text-text-3">
                    {t("common:common.default")}
                  </span>
                )}
              </Button>
            ))}
          {shellProfiles.some((profile) => profile.category === "repl") && (
            <>
              <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
              {shellProfiles
                .filter((profile) => profile.category === "repl")
                .map((profile) => (
                  <Button
                    layout="custom"
                    key={profile.id}
                    className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left`}
                    onClick={() => handlePickProfile(profile)}
                  >
                    <span className="flex-1 truncate">{profile.name}</span>
                  </Button>
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

  if (!hasProfilePicker) {
    return (
      <Button
        variant="tertiary"
        size={density === "sidebar" ? "sidebar" : "small"}
        iconOnly
        aria-label={terminalTitle}
        onClick={(event) => {
          event.stopPropagation();
          onNewTerminal();
        }}
        title={density === "sidebar" ? terminalTitle : undefined}
        icon={
          <HugeiconsIcon
            icon={Add01Icon}
            data-icon="plus"
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={density === "sidebar" ? SIDEBAR_ICON_STROKE_WIDTH : 2}
          />
        }
      />
    );
  }

  return (
    <SplitButton
      ref={shellPickerTriggerRef}
      variant="tertiary"
      size={density === "sidebar" ? "sidebar" : "small"}
      iconOnly
      onClick={(event) => {
        event.stopPropagation();
        onNewTerminal();
      }}
      aria-label={terminalTitle}
      title={density === "sidebar" ? terminalTitle : undefined}
      icon={
        <HugeiconsIcon
          icon={Add01Icon}
          data-icon="plus"
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={density === "sidebar" ? SIDEBAR_ICON_STROKE_WIDTH : 2}
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
      menuSegmentWidth={
        density === "sidebar" ? DROPDOWN_ITEM.iconSize + 4 : undefined
      }
    />
  );
};

export const TerminalNewSessionSplitButton = memo(
  TerminalNewSessionSplitButtonComponent
);
TerminalNewSessionSplitButton.displayName = "TerminalNewSessionSplitButton";
