/**
 * useBackgroundSettings Hook
 * Handles solid background and appearance customization.
 */
import { useAtom } from "jotai";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import {
  BACKGROUND_COLOR_PRESETS,
  getBackgroundColorPresetById,
  resolveBackgroundColorPreset,
} from "@src/config/appearance/backgroundColors";
import { normalizeHexColor } from "@src/config/appearance/backgroundConfig";
import { useUndoStackWithRestore } from "@src/hooks/ui/useUndoableState";
import {
  type BackgroundConfig,
  backgroundConfigPersistAtom,
  sanitizePageOpacity,
  sanitizeSidebarOpacity,
} from "@src/store/ui/backgroundConfigAtom";

import { MAX_CUSTOM_BACKGROUND_COLORS } from "../config";

export interface UseBackgroundSettingsReturn {
  // State
  config: BackgroundConfig;
  // Handlers
  handleColorSelect: (presetId: string) => void;
  handleSelectCustomPaletteHex: (hex: string) => void;
  handleAddCustomPaletteHex: (hex: string) => void;
  handleRemoveCustomPaletteHex: (hex: string, event: React.MouseEvent) => void;
  handlePageOpacityChange: (val: number | number[]) => void;
  handleSidebarOpacityChange: (val: number | number[]) => void;
}

export function useBackgroundSettings(): UseBackgroundSettingsReturn {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useAtom(backgroundConfigPersistAtom);
  // Undo/redo for config changes (Ctrl+Z / Cmd+Z)
  const undoStack = useUndoStackWithRestore<BackgroundConfig>({
    keyboardShortcut: true,
    currentValue: config,
    onRestore: (prev) => setConfig(prev),
  });

  const setConfigWithUndo = useCallback(
    (next: BackgroundConfig) => {
      undoStack.snapshot(config);
      setConfig(next);
    },
    [config, setConfig, undoStack]
  );

  // Handlers
  const handleColorSelect = useCallback(
    (presetId: string) => {
      const preset = getBackgroundColorPresetById(presetId);
      if (!preset) return;
      setConfigWithUndo({
        ...config,
        backgroundColor: resolveBackgroundColorPreset(preset),
        backgroundColorId: preset.id,
      });
    },
    [config, setConfigWithUndo]
  );

  const handleSelectCustomPaletteHex = useCallback(
    (hex: string) => {
      const normalized = normalizeHexColor(hex);
      if (!normalized) return;
      setConfigWithUndo({
        ...config,
        backgroundColor: normalized,
        backgroundColorId: undefined,
      });
    },
    [config, setConfigWithUndo]
  );

  const handleAddCustomPaletteHex = useCallback(
    (hex: string) => {
      const normalized = normalizeHexColor(hex);
      if (!normalized) return;
      const current = [...(config.customColors ?? [])];
      const exists = current.some(
        (entry) => normalizeHexColor(entry) === normalized
      );
      let nextList = current;
      if (!exists) {
        if (current.length >= MAX_CUSTOM_BACKGROUND_COLORS) {
          Message.warning(
            t("background.customColorsLimit", {
              max: MAX_CUSTOM_BACKGROUND_COLORS,
            })
          );
          return;
        }
        nextList = [...current, normalized];
      }
      setConfigWithUndo({
        ...config,
        customColors: nextList,
        backgroundColor: normalized,
        backgroundColorId: undefined,
      });
    },
    [config, setConfigWithUndo, t]
  );

  const handleRemoveCustomPaletteHex = useCallback(
    (hex: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const normalizedRemove = normalizeHexColor(hex);
      if (!normalizedRemove) return;
      const nextList = (config.customColors ?? []).filter(
        (entry) => normalizeHexColor(entry) !== normalizedRemove
      );
      const activeHex =
        config.backgroundColor && !config.backgroundColorId
          ? normalizeHexColor(config.backgroundColor)
          : null;
      const removingActive =
        activeHex !== null && activeHex === normalizedRemove;

      let nextConfig: BackgroundConfig = {
        ...config,
        customColors: nextList,
      };

      if (removingActive) {
        const firstPreset = BACKGROUND_COLOR_PRESETS[0];
        if (firstPreset) {
          nextConfig = {
            ...nextConfig,
            backgroundColor: resolveBackgroundColorPreset(firstPreset),
            backgroundColorId: firstPreset.id,
          };
        }
      }

      setConfigWithUndo(nextConfig);
    },
    [config, setConfigWithUndo]
  );

  const handlePageOpacityChange = useCallback(
    (val: number | number[]) => {
      const raw = Array.isArray(val) ? val[0] : val;
      const pageOpacity = sanitizePageOpacity(raw);
      setConfigWithUndo({ ...config, pageOpacity });
    },
    [config, setConfigWithUndo]
  );

  const handleSidebarOpacityChange = useCallback(
    (val: number | number[]) => {
      const raw = Array.isArray(val) ? val[0] : val;
      const sidebarOpacity = sanitizeSidebarOpacity(raw);
      setConfigWithUndo({ ...config, sidebarOpacity });
    },
    [config, setConfigWithUndo]
  );

  return {
    // State
    config,
    // Handlers
    handleColorSelect,
    handleSelectCustomPaletteHex,
    handleAddCustomPaletteHex,
    handleRemoveCustomPaletteHex,
    handlePageOpacityChange,
    handleSidebarOpacityChange,
  };
}
