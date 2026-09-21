import {
  SECTION_CONTROL_STYLE,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@/src/components/layout/Section";
import { useAtom } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import SegmentedTextPill from "@src/components/SegmentedTextPill";
import Select from "@src/components/Select";
import Slider from "@src/components/Slider";
import Switch from "@src/components/Switch";
import type { ApplicationUiFontId } from "@src/config/appearance/applicationUiFonts";
import {
  APPEARANCE_MODE,
  type AppearanceMode,
} from "@src/config/appearance/globalThemes";
import type { AccentPreset } from "@src/config/appearance/skins/accent";
import {
  BUTTON_TOOLTIP_DELAY_OPTIONS_MS,
  type ButtonTooltipDelayMs,
} from "@src/config/tooltip";
import {
  HOST_DESKTOP,
  resolveHostDesktop,
} from "@src/config/windowChromeRadius";
import { useSetting } from "@src/hooks/settings/useSettings";
import { HugeiconsIcon, MonitorIcon, MoonIcon, Sun01Icon } from "@src/icons";
import {
  type IconStyle,
  IconStyleFigure,
} from "@src/modules/MainApp/Settings/previews/IconStyleFigure";
import {
  LabelWithPreview,
  PreviewGrid,
  previewItems,
  withOptionPreviews,
} from "@src/modules/MainApp/Settings/previews/primitives";
import { BackgroundSettings } from "@src/modules/MainApp/Settings/subpages/BackgroundPage/BackgroundSettings";
import {
  FeaturesSection as EditorFeaturesSection,
  TerminalSection as EditorTerminalSection,
  TypographySection as EditorTypographySection,
} from "@src/modules/MainApp/Settings/subpages/EditorAppearancePage";
import {
  DEFAULT_SIDEBAR_OPACITY,
  MAX_SIDEBAR_OPACITY,
  MIN_SIDEBAR_OPACITY,
  backgroundConfigPersistAtom,
  sanitizeSidebarOpacity,
} from "@src/store/ui/backgroundConfigAtom";
import { sessionBranchTagsVisibleAtom } from "@src/store/ui/sidebarAtom";
import type { SpotlightPlacement } from "@src/store/ui/uiAtom";

import { AppIconPicker } from "./AppIconPicker";
import { AppearanceLayoutSection } from "./AppearanceLayoutSection";
import { ChatPanelAppearanceTab } from "./ChatPanelAppearanceTab";
import {
  HIGH_REFRESH_RATE_SUPPORTED,
  HighRefreshRateRow,
} from "./HighRefreshRateRow";
import { UI_SCALE_OPTIONS, useAppearanceState } from "./useAppearanceState";

const getApproxFontSize = (scale: number): string => {
  const baseFontSize = 14;
  const scaledSize = Math.round((baseFontSize * scale) / 100);
  return `${scaledSize}px`;
};

export const APPEARANCE_TAB_KEYS = {
  APP: "app",
  CODE_EDITOR: "code-editor",
  CHAT_PANEL: "chat-panel",
} as const;

const SPOTLIGHT_PLACEMENT_OPTIONS: SpotlightPlacement[] = ["top", "center"];
const IS_MACOS_HOST = resolveHostDesktop() === HOST_DESKTOP.MACOS;

const renderIconStyle = (style: IconStyle) => <IconStyleFigure style={style} />;

/**
 * Only meaningful while the sidebar is translucent — at an opaque surface the
 * slider would silently do nothing, so it is hidden rather than disabled.
 */
const SidebarOpacityRow: React.FC = () => {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useAtom(backgroundConfigPersistAtom);

  return (
    <SectionRow label={t("background.sidebarOpacity")}>
      <div className="min-w-0" style={SECTION_CONTROL_STYLE}>
        <Slider
          min={MIN_SIDEBAR_OPACITY}
          max={MAX_SIDEBAR_OPACITY}
          value={config.sidebarOpacity ?? DEFAULT_SIDEBAR_OPACITY}
          onValueChange={(value) =>
            setConfig({
              ...config,
              sidebarOpacity: sanitizeSidebarOpacity(value),
            })
          }
          noPadding
        />
      </div>
    </SectionRow>
  );
};

/** Global show/hide + hover delay for button (label + shortcut) tooltips. */
const ButtonTooltipsSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const [enabled, setEnabled] = useSetting("general.buttonTooltipsEnabled");
  const [delayMs, setDelayMs] = useSetting("general.buttonTooltipDelayMs");

  return (
    <SectionContainer title={t("general.tooltips")}>
      <SectionRow
        settingsSearchKeys="general.buttonTooltipsEnabled"
        label={t("general.buttonTooltipsEnabled")}
        description={t("general.buttonTooltipsEnabledDesc")}
      >
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          ariaLabel={t("general.buttonTooltipsEnabled")}
          dataTestId="button-tooltips-enabled-switch"
        />
      </SectionRow>
      {enabled && (
        <SectionRow
          settingsSearchKeys="general.buttonTooltipDelayMs"
          label={t("general.buttonTooltipDelayMs")}
        >
          <SegmentedTextPill<`${ButtonTooltipDelayMs}`>
            ariaLabel={t("general.buttonTooltipDelayMs")}
            value={`${delayMs}`}
            onChange={(value) =>
              setDelayMs(Number(value) as ButtonTooltipDelayMs)
            }
            options={BUTTON_TOOLTIP_DELAY_OPTIONS_MS.map((ms) => ({
              value: `${ms}` as const,
              label:
                ms === 0
                  ? t("general.buttonTooltipDelayImmediate")
                  : t("general.buttonTooltipDelaySeconds", {
                      seconds: ms / 1000,
                    }),
            }))}
            size="large"
            dataTestId="button-tooltip-delay-select"
          />
        </SectionRow>
      )}
    </SectionContainer>
  );
};

interface AppearanceSectionProps {
  activeTab?: string;
}

const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  activeTab = APPEARANCE_TAB_KEYS.APP,
}) => {
  const { t } = useTranslation("settings");
  const [sidebarSelectedRowOpacity, setSidebarSelectedRowOpacity] = useSetting(
    "layout.sidebarSelectedRowOpacity"
  );
  const [sidebarEdgeDepthEnabled, setSidebarEdgeDepthEnabled] = useSetting(
    "layout.sidebarEdgeDepthEnabled"
  );
  const [spotlightDimBackground, setSpotlightDimBackground] = useSetting(
    "general.spotlightDimBackground"
  );
  const [spotlightDetailCard, setSpotlightDetailCard] = useSetting(
    "general.spotlightDetailCard"
  );
  const [usePointerCursors, setUsePointerCursors] = useSetting(
    "general.usePointerCursors"
  );
  const [sessionBranchTagsVisible, setSessionBranchTagsVisible] = useAtom(
    sessionBranchTagsVisibleAtom
  );
  const {
    uiScale,
    applicationUiFont,
    setApplicationUiFont,
    spotlightPlacement,
    setSpotlightPlacement,
    appearanceMode,
    appearanceModeOptions,
    applicationUiFontOptions,
    handleAppearanceModeChange,
    handleUIScaleChange,
    linkSkinVariants,
    setLinkSkinVariants,
    unifiedSkinId,
    unifiedSkinOptions,
    unifiedAccent,
    unifiedAccentOptions,
    lightSkinId,
    setLightSkinId,
    darkSkinId,
    setDarkSkinId,
    lightSkinOptions,
    darkSkinOptions,
    lightAccent,
    setLightAccent,
    darkAccent,
    setDarkAccent,
    lightAccentOptions,
    darkAccentOptions,
    translucentSidebar,
    setTranslucentSidebar,
    iconStyle,
    setIconStyle,
    iconStyleOptions,
    dockIcon,
    setDockIcon,
    dockIconOptions,
  } = useAppearanceState();
  const appearanceModePillOptions = appearanceModeOptions.map((option) => {
    const icon =
      option.value === APPEARANCE_MODE.SYSTEM
        ? MonitorIcon
        : option.value === APPEARANCE_MODE.LIGHT
          ? Sun01Icon
          : MoonIcon;

    return {
      value: option.value,
      ariaLabel: option.label,
      tooltip: option.label,
      label: (
        <HugeiconsIcon
          icon={icon}
          data-icon={`theme-${option.value}`}
          size={14}
          strokeWidth={1.75}
          aria-hidden
        />
      ),
    };
  });

  return (
    <div className={SECTION_GAP_CLASSES}>
      {activeTab === APPEARANCE_TAB_KEYS.APP && (
        <>
          <SectionContainer>
            <SectionRow
              settingsSearchKeys="general.theme"
              label={t("general.appearanceMode")}
            >
              <SegmentedTextPill<AppearanceMode>
                ariaLabel={t("general.appearanceMode")}
                value={appearanceMode}
                onChange={handleAppearanceModeChange}
                options={appearanceModePillOptions}
                size="large"
              />
            </SectionRow>
            <SectionRow
              settingsSearchKeys="general.applicationUiFont"
              label={t("general.applicationFont")}
            >
              <Select
                value={applicationUiFont}
                onChange={(value) =>
                  setApplicationUiFont(value as ApplicationUiFontId)
                }
                options={applicationUiFontOptions}
                showSearch
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
            <SectionRow
              settingsSearchKeys="general.uiScale"
              label={t("general.uiScale")}
            >
              <Select
                value={String(uiScale)}
                onChange={(value) => handleUIScaleChange(String(value))}
                options={UI_SCALE_OPTIONS.map((scale) => ({
                  label: `${scale}% · ${getApproxFontSize(scale)}`,
                  value: String(scale),
                }))}
                size="default"
                style={SECTION_CONTROL_STYLE}
              />
            </SectionRow>
            {HIGH_REFRESH_RATE_SUPPORTED && (
              <HighRefreshRateRow settingsSearchKeys="general.highRefreshRate" />
            )}
          </SectionContainer>

          <SectionContainer title={t("general.skins")}>
            <SectionRow
              settingsSearchKeys="general.linkSkinVariants"
              label={t("general.linkSkinVariants")}
              description={t("general.linkSkinVariantsDesc")}
            >
              <Switch
                checked={linkSkinVariants}
                onCheckedChange={setLinkSkinVariants}
                ariaLabel={t("general.linkSkinVariants")}
                dataTestId="link-skin-variants-switch"
              />
            </SectionRow>
            {linkSkinVariants ? (
              <>
                <SectionRow
                  settingsSearchKeys={["general.lightSkin", "general.darkSkin"]}
                  label={t("general.skin")}
                >
                  <Select
                    value={unifiedSkinId}
                    onChange={(value) => setLightSkinId(String(value))}
                    options={unifiedSkinOptions}
                    showSearch
                    showTriggerIcon
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dataTestId="unified-skin-select"
                  />
                </SectionRow>
                <SectionRow
                  settingsSearchKeys={[
                    "general.primaryColorLight",
                    "general.primaryColorDark",
                  ]}
                  label={t("general.accent")}
                >
                  <Select
                    value={unifiedAccent}
                    onChange={(value) =>
                      setLightAccent(String(value) as AccentPreset)
                    }
                    options={unifiedAccentOptions}
                    showSearch
                    showTriggerIcon
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dataTestId="unified-accent-select"
                  />
                </SectionRow>
              </>
            ) : (
              <>
                <SectionRow
                  settingsSearchKeys="general.lightSkin"
                  label={t("general.lightSkin")}
                  description={t("general.skinsDesc")}
                >
                  <Select
                    value={lightSkinId}
                    onChange={(value) => setLightSkinId(String(value))}
                    options={lightSkinOptions}
                    showSearch
                    showTriggerIcon
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dataTestId="light-skin-select"
                  />
                </SectionRow>
                <SectionRow
                  settingsSearchKeys="general.darkSkin"
                  label={t("general.darkSkin")}
                >
                  <Select
                    value={darkSkinId}
                    onChange={(value) => setDarkSkinId(String(value))}
                    options={darkSkinOptions}
                    showSearch
                    showTriggerIcon
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dataTestId="dark-skin-select"
                  />
                </SectionRow>
                <SectionRow
                  settingsSearchKeys="general.primaryColorLight"
                  label={t("general.lightAccent")}
                >
                  <Select
                    value={lightAccent}
                    onChange={(value) =>
                      setLightAccent(String(value) as AccentPreset)
                    }
                    options={lightAccentOptions}
                    showSearch
                    showTriggerIcon
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dataTestId="light-accent-select"
                  />
                </SectionRow>
                <SectionRow
                  settingsSearchKeys="general.primaryColorDark"
                  label={t("general.darkAccent")}
                >
                  <Select
                    value={darkAccent}
                    onChange={(value) =>
                      setDarkAccent(String(value) as AccentPreset)
                    }
                    options={darkAccentOptions}
                    showSearch
                    showTriggerIcon
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dataTestId="dark-accent-select"
                  />
                </SectionRow>
              </>
            )}
          </SectionContainer>

          <SectionContainer>
            <SectionRow
              settingsSearchKeys="general.dockIcon"
              label={t("general.appIcon")}
            >
              <AppIconPicker
                value={dockIcon}
                options={dockIconOptions}
                onChange={setDockIcon}
                ariaLabel={t("general.appIcon")}
                dataTestId="app-icon-picker"
              />
            </SectionRow>
          </SectionContainer>

          <SectionContainer title={t("general.preferences")}>
            <SectionRow
              settingsSearchKeys="general.usePointerCursors"
              label={t("general.usePointerCursors")}
              description={t("general.usePointerCursorsDesc")}
            >
              <Switch
                checked={usePointerCursors}
                onCheckedChange={setUsePointerCursors}
                ariaLabel={t("general.usePointerCursors")}
                dataTestId="use-pointer-cursors-switch"
              />
            </SectionRow>
            <SectionRow
              settingsSearchKeys="general.iconStyle"
              label={
                <LabelWithPreview
                  label={t("general.iconStyle")}
                  preview={
                    <PreviewGrid
                      items={previewItems(iconStyleOptions, renderIconStyle)}
                    />
                  }
                />
              }
            >
              <SegmentedTextPill<"colorful" | "monochrome">
                ariaLabel={t("general.iconStyle")}
                value={iconStyle}
                onChange={setIconStyle}
                options={withOptionPreviews(iconStyleOptions, renderIconStyle)}
                size="large"
                dataTestId="icon-style-select"
              />
            </SectionRow>
          </SectionContainer>

          <ButtonTooltipsSection />

          <AppearanceLayoutSection />

          <SectionContainer title={t("general.sidebar")}>
            <SectionRow
              settingsSearchKeys="general.translucentSidebar"
              label={t("general.translucentSidebar")}
            >
              <Switch
                checked={translucentSidebar}
                onCheckedChange={setTranslucentSidebar}
                ariaLabel={t("general.translucentSidebar")}
                dataTestId="translucent-sidebar-switch"
              />
            </SectionRow>
            {translucentSidebar && <SidebarOpacityRow />}
            <SectionRow
              settingsSearchKeys="layout.sidebarSelectedRowOpacity"
              label={t("general.selectedItemTransparency")}
            >
              <div className="min-w-0" style={SECTION_CONTROL_STYLE}>
                <Slider
                  min={0}
                  max={20}
                  value={sidebarSelectedRowOpacity}
                  onValueChange={(value) =>
                    setSidebarSelectedRowOpacity(
                      Array.isArray(value) ? value[0] : value
                    )
                  }
                  noPadding
                />
              </div>
            </SectionRow>
            {IS_MACOS_HOST && (
              <SectionRow
                settingsSearchKeys="layout.sidebarEdgeDepthEnabled"
                label={t("general.sidebarEdgeDepth")}
              >
                <Switch
                  checked={sidebarEdgeDepthEnabled}
                  onCheckedChange={setSidebarEdgeDepthEnabled}
                />
              </SectionRow>
            )}
            <SectionRow label={t("general.sessionBranchTags")}>
              <Switch
                checked={sessionBranchTagsVisible}
                onCheckedChange={setSessionBranchTagsVisible}
                ariaLabel={t("general.sessionBranchTags")}
                dataTestId="session-branch-tags-switch"
              />
            </SectionRow>
          </SectionContainer>

          <SectionContainer title={t("general.spotlight")}>
            <SectionRow
              settingsSearchKeys="general.spotlightPlacement"
              label={t("general.spotlightPlacement")}
            >
              <SegmentedTextPill<SpotlightPlacement>
                ariaLabel={t("general.spotlightPlacement")}
                value={spotlightPlacement}
                onChange={setSpotlightPlacement}
                options={SPOTLIGHT_PLACEMENT_OPTIONS.map((placement) => ({
                  label: t(`general.spotlightPlacementOptions.${placement}`),
                  value: placement,
                }))}
                size="large"
              />
            </SectionRow>
            <SectionRow
              settingsSearchKeys="general.spotlightDimBackground"
              label={t("general.spotlightDimBackground")}
            >
              <Switch
                checked={spotlightDimBackground}
                onCheckedChange={setSpotlightDimBackground}
              />
            </SectionRow>
            <SectionRow
              settingsSearchKeys="general.spotlightDetailCard"
              label={t("general.spotlightDetailCard")}
            >
              <Switch
                checked={spotlightDetailCard}
                onCheckedChange={setSpotlightDetailCard}
              />
            </SectionRow>
          </SectionContainer>

          {!IS_MACOS_HOST && <BackgroundSettings />}
        </>
      )}

      {activeTab === APPEARANCE_TAB_KEYS.CODE_EDITOR && (
        <>
          <EditorTypographySection showTitle={false} />
          <EditorTerminalSection />
          <EditorFeaturesSection />
        </>
      )}

      {activeTab === APPEARANCE_TAB_KEYS.CHAT_PANEL && (
        <ChatPanelAppearanceTab />
      )}
    </div>
  );
};

export default AppearanceSection;
