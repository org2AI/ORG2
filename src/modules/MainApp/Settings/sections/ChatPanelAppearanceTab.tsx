import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/components/layout/Section";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import NumberInput from "@src/components/NumberInput";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
import SendOnEnterPill from "@src/components/SendOnEnterPill";
import Switch from "@src/components/Switch";
import {
  CREATOR_COMPOSER_POSITION,
  type CreatorComposerPosition,
} from "@src/config/sessionCreatorConfig";
import { useAgentConfig } from "@src/hooks/config/useAgentConfig";
import {
  CompactInputFigure,
  ComposerGlowFigure,
  InputPositionFigure,
  PinnedSkillsFigure,
  RepoBarPositionFigure,
  SeparateEffortFigure,
} from "@src/modules/MainApp/Settings/previews/composerPreviews";
import {
  LabelWithPreview,
  PreviewGrid,
  offOnPreview,
  previewItems,
  withOptionPreviews,
} from "@src/modules/MainApp/Settings/previews/primitives";
import { DEFAULT_CHAT_APPEARANCE } from "@src/store/config/configAtom";
import { compactComposerInputAtom } from "@src/store/session/compactComposerInputAtom";
import { composerGlowVisibleAtom } from "@src/store/session/composerGlowVisibleAtom";
import { creatorComposerPositionAtom } from "@src/store/session/creatorComposerPositionAtom";
import { creatorLaunchpadActionsVisibleAtom } from "@src/store/session/creatorLaunchpadActionsVisibleAtom";
import { creatorLaunchpadSearchVisibleAtom } from "@src/store/session/creatorLaunchpadSearchVisibleAtom";
import {
  type CreatorRepoChromePosition,
  changeCreatorComposerPositionAtom,
  creatorRepoChromePositionAtom,
} from "@src/store/session/creatorRepoChromePositionAtom";
import { pinnedActionsVisibleAtom } from "@src/store/session/pinnedActionsVisibleAtom";
import { separateEffortPillAtom } from "@src/store/session/separateEffortPillAtom";
import {
  chatHistoryDisplayModeAtom,
  chatTokenUsageVisibleAtom,
  chatTurnMetadataVisibleAtom,
  chatTurnPaginationEnabledAtom,
  collapseToolActivityAtom,
} from "@src/store/ui/chatPanel/displayPrefsAtoms";
import {
  LINK_OPEN_TARGETS,
  type LinkOpenTarget,
  linkOpenTargetAtom,
} from "@src/store/ui/linkOpenTargetAtom";

const renderInputPosition = (position: CreatorComposerPosition) => (
  <InputPositionFigure position={position} />
);
const renderRepoBarPosition = (position: CreatorRepoChromePosition) => (
  <RepoBarPositionFigure position={position} />
);

const LINK_OPEN_TARGET_LABEL_KEYS = {
  internal: "sessions:chat.navigation.internalBrowser",
  external: "sessions:chat.navigation.externalBrowser",
} as const satisfies Record<LinkOpenTarget, string>;

interface PreferenceSwitchRowProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  dataTestId: string;
  settingsSearchKeys?: string;
  /** Info-icon tooltip sketching the setting's Off/On states. */
  preview?: React.ReactNode;
}

function PreferenceSwitchRow({
  label,
  checked,
  onCheckedChange,
  dataTestId,
  settingsSearchKeys,
  preview,
}: PreferenceSwitchRowProps) {
  return (
    <SectionRow
      settingsSearchKeys={settingsSearchKeys}
      label={
        preview ? <LabelWithPreview label={label} preview={preview} /> : label
      }
    >
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        ariaLabel={label}
        dataTestId={dataTestId}
      />
    </SectionRow>
  );
}

/**
 * Chat history display preferences. Bound to the same atoms as the session
 * header "…" menu, so either surface reflects a change made on the other.
 */
const ChatHistorySection: React.FC = () => {
  const { t } = useTranslation("settings");
  const [paginationEnabled, setPaginationEnabled] = useAtom(
    chatTurnPaginationEnabledAtom
  );
  const [tokenUsageVisible, setTokenUsageVisible] = useAtom(
    chatTokenUsageVisibleAtom
  );
  const [turnMetadataVisible, setTurnMetadataVisible] = useAtom(
    chatTurnMetadataVisibleAtom
  );
  const [displayMode, setDisplayMode] = useAtom(chatHistoryDisplayModeAtom);
  const [collapseToolActivity, setCollapseToolActivity] = useAtom(
    collapseToolActivityAtom
  );
  const [linkOpenTarget, setLinkOpenTarget] = useAtom(linkOpenTargetAtom);

  return (
    <SectionContainer title={t("appearance.chatHistory")}>
      <PreferenceSwitchRow
        settingsSearchKeys="general.chatTurnPaginationEnabled"
        label={t("common:layoutSettings.paginateChatHistory")}
        checked={paginationEnabled}
        onCheckedChange={setPaginationEnabled}
        dataTestId="chat-history-pagination-switch"
      />
      <PreferenceSwitchRow
        label={t("sessions:chat.showTokenUsage")}
        checked={tokenUsageVisible}
        onCheckedChange={setTokenUsageVisible}
        dataTestId="chat-token-usage-switch"
      />
      <PreferenceSwitchRow
        label={t("sessions:chat.showTurnMetadata")}
        checked={turnMetadataVisible}
        onCheckedChange={setTurnMetadataVisible}
        dataTestId="chat-turn-metadata-switch"
      />
      <PreferenceSwitchRow
        label={t("sessions:chat.showInlineDiffs")}
        checked={displayMode === "full"}
        onCheckedChange={(checked) =>
          setDisplayMode(checked ? "full" : "compact")
        }
        dataTestId="chat-inline-diffs-switch"
      />
      <PreferenceSwitchRow
        label={t("sessions:chat.collapseToolActivity")}
        checked={collapseToolActivity}
        onCheckedChange={setCollapseToolActivity}
        dataTestId="chat-collapse-tool-activity-switch"
      />
      <SectionRow label={t("sessions:chat.navigation.openLinksIn")}>
        <SegmentedTextPill<LinkOpenTarget>
          ariaLabel={t("sessions:chat.navigation.openLinksIn")}
          value={linkOpenTarget}
          onChange={setLinkOpenTarget}
          options={LINK_OPEN_TARGETS.map((target) => ({
            value: target,
            label: t(LINK_OPEN_TARGET_LABEL_KEYS[target]),
          }))}
          size="large"
          dataTestId="chat-link-open-target-select"
        />
      </SectionRow>
    </SectionContainer>
  );
};

/** New chat page layout, shared with the new-chat header "…" menu. */
const NewChatPageSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const [launchpadSearchVisible, setLaunchpadSearchVisible] = useAtom(
    creatorLaunchpadSearchVisibleAtom
  );
  const [launchpadActionsVisible, setLaunchpadActionsVisible] = useAtom(
    creatorLaunchpadActionsVisibleAtom
  );
  const composerPosition = useAtomValue(creatorComposerPositionAtom);
  const setComposerPosition = useSetAtom(changeCreatorComposerPositionAtom);
  const [repoBarPosition, setRepoBarPosition] = useAtom(
    creatorRepoChromePositionAtom
  );
  const inputPositionOptions = [
    {
      value: CREATOR_COMPOSER_POSITION.BOTTOM,
      label: t("sessions:chat.startPage.positionBottom"),
    },
    {
      value: CREATOR_COMPOSER_POSITION.MIDDLE,
      label: t("sessions:chat.startPage.positionMiddle"),
    },
  ] as const;
  const repoBarPositionOptions = [
    { value: "top", label: t("sessions:chat.startPage.positionUp") },
    { value: "bottom", label: t("sessions:chat.startPage.positionDown") },
  ] as const;

  return (
    <SectionContainer title={t("appearance.newChatPage")}>
      <PreferenceSwitchRow
        label={t("sessions:chat.startPage.showSpotlight")}
        checked={launchpadSearchVisible}
        onCheckedChange={setLaunchpadSearchVisible}
        dataTestId="new-chat-page-spotlight-switch"
      />
      <PreferenceSwitchRow
        label={t("sessions:chat.startPage.showQuickActions")}
        checked={launchpadActionsVisible}
        onCheckedChange={setLaunchpadActionsVisible}
        dataTestId="new-chat-page-quick-actions-switch"
      />
      <SectionRow
        label={
          <LabelWithPreview
            label={t("sessions:chat.startPage.inputPosition")}
            preview={
              <PreviewGrid
                items={previewItems(inputPositionOptions, renderInputPosition)}
              />
            }
          />
        }
      >
        <SegmentedTextPill<CreatorComposerPosition>
          ariaLabel={t("sessions:chat.startPage.inputPosition")}
          value={composerPosition}
          onChange={setComposerPosition}
          options={withOptionPreviews(
            inputPositionOptions,
            renderInputPosition
          )}
          size="large"
          dataTestId="new-chat-page-input-position-select"
        />
      </SectionRow>
      <SectionRow
        label={
          <LabelWithPreview
            label={t("sessions:chat.startPage.repoBarPosition")}
            preview={
              <PreviewGrid
                items={previewItems(
                  repoBarPositionOptions,
                  renderRepoBarPosition
                )}
              />
            }
          />
        }
      >
        <SegmentedTextPill<CreatorRepoChromePosition>
          ariaLabel={t("sessions:chat.startPage.repoBarPosition")}
          value={repoBarPosition}
          onChange={setRepoBarPosition}
          options={withOptionPreviews(
            repoBarPositionOptions,
            renderRepoBarPosition
          )}
          size="large"
          dataTestId="new-chat-page-repo-bar-position-select"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export const ChatPanelAppearanceTab: React.FC = () => {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const { chatAppearance, updateChatAppearance } = useAgentConfig();
  // Composer preferences share atoms with the session "…" Input menu.
  const [pinnedActionsVisible, setPinnedActionsVisible] = useAtom(
    pinnedActionsVisibleAtom
  );
  const [compactComposerInput, setCompactComposerInput] = useAtom(
    compactComposerInputAtom
  );
  const [composerGlowVisible, setComposerGlowVisible] = useAtom(
    composerGlowVisibleAtom
  );
  const [separateEffortPill, setSeparateEffortPill] = useAtom(
    separateEffortPillAtom
  );

  return (
    <>
      <SectionContainer>
        <SectionRow
          settingsSearchKeys="chat.fontSize"
          label={t("agentSessions.chatFontSize")}
        >
          <NumberInput
            value={chatAppearance.fontSize}
            min={10}
            max={16}
            step={1}
            suffix={tCommon("common.px")}
            controlsPosition="sides"
            onValueChange={(value) => {
              updateChatAppearance({
                fontSize: value ?? DEFAULT_CHAT_APPEARANCE.fontSize,
              });
            }}
            size="default"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          settingsSearchKeys="chat.codeFontSize"
          label={t("agentSessions.codeFontSize")}
        >
          <NumberInput
            value={chatAppearance.codeFontSize}
            min={10}
            max={16}
            step={1}
            suffix={tCommon("common.px")}
            controlsPosition="sides"
            onValueChange={(value) => {
              updateChatAppearance({ codeFontSize: value ?? 13 });
            }}
            size="default"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          settingsSearchKeys="chat.lineHeight"
          label={t("agentSessions.lineHeight")}
        >
          <NumberInput
            value={chatAppearance.lineHeight}
            min={1.2}
            max={2.0}
            step={0.1}
            suffix={tCommon("common.multiplier")}
            controlsPosition="sides"
            onValueChange={(value) => {
              updateChatAppearance({ lineHeight: value ?? 1.6 });
            }}
            size="default"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>

      <SectionContainer>
        <SectionRow
          settingsSearchKeys="chat.typingEffectEnabled"
          label={t("agentSessions.typingAnimation")}
          description={t("agentSessions.typingAnimationDesc")}
        >
          <Switch
            checked={chatAppearance.typingEffectEnabled}
            onCheckedChange={(checked) => {
              updateChatAppearance({ typingEffectEnabled: checked });
            }}
          />
        </SectionRow>
        {chatAppearance.typingEffectEnabled && (
          <SectionRow
            settingsSearchKeys="chat.typingSpeed"
            label={t("agentSessions.typingSpeed")}
            description={t("agentSessions.typingSpeedDesc")}
            indent
          >
            <NumberInput
              value={chatAppearance.typingSpeed}
              min={1}
              max={50}
              suffix={tCommon("common.ms")}
              controlsPosition="sides"
              onValueChange={(value) => {
                updateChatAppearance({ typingSpeed: value ?? 5 });
              }}
              size="default"
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        )}
      </SectionContainer>

      <ChatHistorySection />

      <SectionContainer title={t("appearance.composer")}>
        <SectionRow
          settingsSearchKeys="chat.sendOnEnter"
          label={t("agentSessions.sendOnEnter")}
          description={t("agentSessions.sendOnEnterDesc")}
        >
          <SendOnEnterPill
            ariaLabel={t("agentSessions.sendOnEnter")}
            sendOnEnter={chatAppearance.sendOnEnter}
            onChange={(sendOnEnter) => {
              updateChatAppearance({ sendOnEnter });
            }}
          />
        </SectionRow>
        <PreferenceSwitchRow
          label={t("sessions:chat.startPage.showSkills")}
          checked={pinnedActionsVisible}
          onCheckedChange={setPinnedActionsVisible}
          dataTestId="composer-pinned-skills-switch"
          preview={offOnPreview(PinnedSkillsFigure)}
        />
        <PreferenceSwitchRow
          label={t("sessions:chat.compactInput")}
          checked={compactComposerInput}
          onCheckedChange={setCompactComposerInput}
          dataTestId="composer-compact-input-switch"
          preview={offOnPreview(CompactInputFigure)}
        />
        <PreferenceSwitchRow
          label={t("sessions:chat.composerGlow")}
          checked={composerGlowVisible}
          onCheckedChange={setComposerGlowVisible}
          dataTestId="composer-glow-switch"
          preview={offOnPreview(ComposerGlowFigure)}
        />
        <PreferenceSwitchRow
          label={t("sessions:chat.separateEffortPill")}
          checked={separateEffortPill}
          onCheckedChange={setSeparateEffortPill}
          dataTestId="composer-separate-effort-pill-switch"
          preview={offOnPreview(SeparateEffortFigure)}
        />
      </SectionContainer>

      <NewChatPageSection />
    </>
  );
};
