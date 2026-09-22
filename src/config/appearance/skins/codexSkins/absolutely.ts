/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_ABSOLUTELY_SKIN: SkinDefinition = {
  id: "codex-absolutely",
  label: "Absolutely",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#f9f9f7",
        ink: "#2d2d2b",
        accent: "#cc7d5e",
        contrast: 45,
        semanticColors: {
          diffAdded: "#00a240",
          diffRemoved: "#ba2623",
          skill: "#cc7d5e",
        },
        syntax: {
          comment: "#939391",
          string: "#00c853",
          keyword: "#ff5f38",
          function: "#2d2d2b",
          variable: "#2d2d2b",
          number: "#ff5f38",
          operator: "#ff5f38",
          property: "#bc7559",
          type: "#bc7559",
          constant: "#ff5f38",
        },
      },
      sourceName: "Absolutely Light",
    },
    dark: {
      seed: {
        surface: "#2d2d2b",
        ink: "#f9f9f7",
        accent: "#cc7d5e",
        contrast: 60,
        semanticColors: {
          diffAdded: "#40c977",
          diffRemoved: "#fa423e",
          skill: "#cc7d5e",
        },
        syntax: {
          comment: "#b2b2b0",
          string: "#00c853",
          keyword: "#ff5f38",
          function: "#f9f9f7",
          variable: "#f9f9f7",
          number: "#ff5f38",
          operator: "#ff5f38",
          property: "#d28e73",
          type: "#d28e73",
          constant: "#ff5f38",
        },
      },
      sourceName: "Absolutely Dark",
    },
  },
};
