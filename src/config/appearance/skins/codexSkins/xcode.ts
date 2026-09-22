/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_XCODE_SKIN: SkinDefinition = {
  id: "codex-xcode",
  label: "Xcode",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#ffffff",
        ink: "#000000",
        accent: "#0e0eff",
        contrast: 45,
        semanticColors: {
          diffAdded: "#00a240",
          diffRemoved: "#ba2623",
          skill: "#0e0eff",
        },
        syntax: {
          comment: "#5d6c79",
          string: "#c41a16",
          keyword: "#9b2393",
          function: "#326d74",
          variable: "#326d74",
          number: "#1c00cf",
          operator: "#9b2393",
          property: "#0b4f79",
          type: "#0b4f79",
          constant: "#1c00cf",
        },
      },
      sourceName: "Xcode Light",
    },
    dark: {
      seed: {
        surface: "#1f1f24",
        ink: "#ffffff",
        accent: "#5482ff",
        contrast: 60,
        semanticColors: {
          diffAdded: "#40c977",
          diffRemoved: "#fa423e",
          skill: "#5482ff",
        },
        syntax: {
          comment: "#6c7986",
          string: "#fc6a5d",
          keyword: "#fc5fa3",
          function: "#67b7a4",
          variable: "#67b7a4",
          number: "#d0bf69",
          operator: "#fc5fa3",
          property: "#5dd8ff",
          type: "#5dd8ff",
          constant: "#d0bf69",
        },
      },
      sourceName: "Xcode Dark",
    },
  },
};
