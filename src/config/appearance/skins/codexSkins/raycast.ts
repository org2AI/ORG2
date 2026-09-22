/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_RAYCAST_SKIN: SkinDefinition = {
  id: "codex-raycast",
  label: "Raycast",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#ffffff",
        ink: "#030303",
        accent: "#ff6363",
        contrast: 45,
        semanticColors: {
          diffAdded: "#006b4f",
          diffRemoved: "#b12424",
          skill: "#9a1b6e",
        },
        syntax: {
          comment: "#999999",
          string: "#c03030",
          keyword: "#666666",
          function: "#c75d07",
          variable: "#000000",
          number: "#000000",
          operator: "#000000",
          tag: "#c75d07",
          attribute: "#c75d07",
          property: "#666666",
          type: "#c75d07",
          constant: "#000000",
        },
      },
      sourceName: "Raycast Light",
    },
    dark: {
      seed: {
        surface: "#101010",
        ink: "#fefefe",
        accent: "#ff6363",
        contrast: 60,
        semanticColors: {
          diffAdded: "#59d499",
          diffRemoved: "#ff6363",
          skill: "#cf2f98",
        },
        syntax: {
          comment: "#666666",
          string: "#ff6363",
          keyword: "#999999",
          function: "#ff9217",
          variable: "#ffffff",
          number: "#ffffff",
          operator: "#ffffff",
          tag: "#ff6363",
          attribute: "#ff9217",
          property: "#999999",
          type: "#ff9217",
          constant: "#ffffff",
        },
      },
      sourceName: "Raycast Dark",
    },
  },
};
