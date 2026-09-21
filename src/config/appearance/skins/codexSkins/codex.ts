/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_CODEX_SKIN: SkinDefinition = {
  id: "codex-codex",
  label: "Codex",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#ffffff",
        ink: "#0d0d0d",
        accent: "#0169cc",
        contrast: 45,
        semanticColors: {
          diffAdded: "#00a240",
          diffRemoved: "#e02e2a",
          skill: "#751ed9",
        },
        syntax: {
          comment: "#666666",
          string: "#008809",
          keyword: "#d53538",
          function: "#751ed9",
          variable: "#bd5800",
          number: "#0071ea",
          operator: "#666666",
          tag: "#d53538",
          attribute: "#0071ea",
          property: "#666666",
          type: "#751ed9",
          constant: "#0071ea",
          invalid: "#ffffff",
        },
      },
      sourceName: "Codex Light",
    },
    dark: {
      seed: {
        surface: "#111111",
        ink: "#fcfcfc",
        accent: "#0169cc",
        contrast: 60,
        semanticColors: {
          diffAdded: "#00a240",
          diffRemoved: "#e02e2a",
          skill: "#b06dff",
        },
        syntax: {
          comment: "#999999",
          string: "#85df7b",
          keyword: "#f67576",
          function: "#b06dff",
          variable: "#fa994c",
          number: "#6dcbf4",
          operator: "#999999",
          tag: "#f67576",
          attribute: "#6dcbf4",
          property: "#999999",
          type: "#b06dff",
          constant: "#6dcbf4",
          invalid: "#ffffff",
        },
      },
      sourceName: "Codex Dark",
    },
  },
};
