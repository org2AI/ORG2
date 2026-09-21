import { useAtom } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import { ActionSubmenu } from "@src/components/Dropdown/ActionMenuSurface";
import {
  MenuControlRow,
  MenuSegmentedRow,
  MenuSwitchRow,
} from "@src/components/Dropdown/MenuControlRows";
import { DROPDOWN_ITEM } from "@src/components/Dropdown/tokens";
import SendOnEnterPill from "@src/components/SendOnEnterPill";
import { HugeiconsIcon, InputCursorTextIcon } from "@src/icons";
import { chatSendOnEnterAtom } from "@src/store/config/configAtom";
import { compactComposerInputAtom } from "@src/store/session/compactComposerInputAtom";
import { composerGlowVisibleAtom } from "@src/store/session/composerGlowVisibleAtom";
import { creatorRepoChromePositionAtom } from "@src/store/session/creatorRepoChromePositionAtom";
import { pinnedActionsVisibleAtom } from "@src/store/session/pinnedActionsVisibleAtom";
import { separateEffortPillAtom } from "@src/store/session/separateEffortPillAtom";

/**
 * `session`: the session "…" menu. `launchpad`: the new-chat "…" menu, which
 * adds the repo-bar position and omits Compact input (SessionCreator does not
 * read that preference).
 */
export type SessionInputSettingsVariant = "session" | "launchpad";

const TEST_IDS = {
  session: {
    submenu: "session-input-settings-submenu",
    sendOnEnter: "session-menu-send-on-enter",
    showSkills: "session-menu-show-skills-toggle",
    compactInput: "session-menu-compact-input-toggle",
    composerGlow: "session-menu-composer-glow-toggle",
    separateEffortPill: "session-menu-separate-effort-pill-toggle",
  },
  launchpad: {
    submenu: "new-chat-input-settings-submenu",
    sendOnEnter: "new-chat-send-on-enter",
    showSkills: "new-chat-show-skills-toggle",
    compactInput: undefined,
    composerGlow: "new-chat-composer-glow-toggle",
    separateEffortPill: "new-chat-separate-effort-pill-toggle",
  },
} as const satisfies Record<SessionInputSettingsVariant, unknown>;

function RepoBarPositionRow(): React.ReactNode {
  const { t } = useTranslation("sessions");
  const [repoBarPosition, setRepoBarPosition] = useAtom(
    creatorRepoChromePositionAtom
  );
  return (
    <MenuSegmentedRow
      label={t("chat.startPage.repoBarPosition")}
      dataTestId="new-chat-repo-bar-position"
      value={repoBarPosition}
      options={[
        { value: "top", label: t("chat.startPage.positionUp") },
        { value: "bottom", label: t("chat.startPage.positionDown") },
      ]}
      onChange={setRepoBarPosition}
    />
  );
}

function CompactInputRow({ dataTestId }: { dataTestId: string }) {
  const { t } = useTranslation("sessions");
  const [compactComposerInput, setCompactComposerInput] = useAtom(
    compactComposerInputAtom
  );
  return (
    <MenuSwitchRow
      label={t("chat.compactInput")}
      checked={compactComposerInput}
      onCheckedChange={setCompactComposerInput}
      dataTestId={dataTestId}
    />
  );
}

/** The Input settings flyout shared by the session and launchpad "…" menus. */
export function SessionInputSettingsSubmenu({
  variant = "session",
}: {
  variant?: SessionInputSettingsVariant;
}): React.ReactNode {
  const { t } = useTranslation("sessions");
  const testIds = TEST_IDS[variant];
  const [sendOnEnter, setSendOnEnter] = useAtom(chatSendOnEnterAtom);
  const [pinnedActionsVisible, setPinnedActionsVisible] = useAtom(
    pinnedActionsVisibleAtom
  );
  const [composerGlowVisible, setComposerGlowVisible] = useAtom(
    composerGlowVisibleAtom
  );
  const [separateEffortPill, setSeparateEffortPill] = useAtom(
    separateEffortPillAtom
  );
  const sendMethodLabel = t("chat.sendMethod");

  return (
    <ActionSubmenu
      label={t("chat.inputSettings")}
      icon={
        <HugeiconsIcon
          icon={InputCursorTextIcon}
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.75}
        />
      }
      dataTestId={testIds.submenu}
    >
      {variant === "launchpad" && <RepoBarPositionRow />}
      <MenuControlRow label={sendMethodLabel}>
        <SendOnEnterPill
          size="small"
          ariaLabel={sendMethodLabel}
          dataTestId={testIds.sendOnEnter}
          sendOnEnter={sendOnEnter}
          onChange={setSendOnEnter}
        />
      </MenuControlRow>
      <MenuSwitchRow
        label={t("chat.startPage.showSkills")}
        checked={pinnedActionsVisible}
        onCheckedChange={setPinnedActionsVisible}
        dataTestId={testIds.showSkills}
      />
      {testIds.compactInput && (
        <CompactInputRow dataTestId={testIds.compactInput} />
      )}
      <MenuSwitchRow
        label={t("chat.composerGlow")}
        checked={composerGlowVisible}
        onCheckedChange={setComposerGlowVisible}
        dataTestId={testIds.composerGlow}
      />
      <MenuSwitchRow
        label={t("chat.separateEffortPill")}
        checked={separateEffortPill}
        onCheckedChange={setSeparateEffortPill}
        dataTestId={testIds.separateEffortPill}
      />
    </ActionSubmenu>
  );
}
