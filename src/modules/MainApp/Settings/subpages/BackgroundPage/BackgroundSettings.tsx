/**
 * BackgroundSettings Component
 * Main orchestrator for background customization settings
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Slider from "@src/components/Slider";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";
import {
  DEFAULT_PAGE_OPACITY,
  MAX_PAGE_OPACITY,
  MIN_PAGE_OPACITY,
} from "@src/store/ui/backgroundConfigAtom";

import { ColorSection } from "./components/ColorSection";
import { useBackgroundSettings } from "./hooks/useBackgroundSettings";

export const BackgroundSettings: React.FC = () => {
  const { t } = useTranslation("settings");

  const {
    // State
    config,
    // Handlers
    handleColorSelect,
    handleSelectCustomPaletteHex,
    handleAddCustomPaletteHex,
    handleRemoveCustomPaletteHex,
    handlePageOpacityChange,
  } = useBackgroundSettings();

  return (
    <SectionContainer title={t("background.title")}>
      <ColorSection
        config={config}
        translationNamespace="settings"
        onColorSelect={handleColorSelect}
        onSelectCustomHex={handleSelectCustomPaletteHex}
        onAddCustomHex={handleAddCustomPaletteHex}
        onRemoveCustomHex={handleRemoveCustomPaletteHex}
      />

      <SectionRow label={t("background.pageOpacity")}>
        <div className="min-w-0" style={SECTION_CONTROL_STYLE}>
          <Slider
            min={MIN_PAGE_OPACITY}
            max={MAX_PAGE_OPACITY}
            value={config.pageOpacity ?? DEFAULT_PAGE_OPACITY}
            onValueChange={handlePageOpacityChange}
            noPadding
          />
        </div>
      </SectionRow>
    </SectionContainer>
  );
};
