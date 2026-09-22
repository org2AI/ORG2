/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_EVERFOREST_SKIN: SkinDefinition = {
  id: "codex-everforest",
  label: "Everforest",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#fdf6e3",
        ink: "#5c6a72",
        accent: "#93b259",
        contrast: 45,
        semanticColors: {
          diffAdded: "#8da101",
          diffRemoved: "#f85552",
          skill: "#df69ba",
        },
        syntax: {
          comment: "#939f91",
          string: "#dfa000",
          keyword: "#f85552",
          function: "#8da101",
          variable: "#5c6a72",
          number: "#df69ba",
          operator: "#f57d26",
          tag: "#f57d26",
          attribute: "#dfa000",
          property: "#5c6a72",
          type: "#3a94c5",
          constant: "#df69ba",
        },
      },
      sourceName: "everforest-light",
    },
    dark: {
      seed: {
        surface: "#2d353b",
        ink: "#d3c6aa",
        accent: "#a7c080",
        contrast: 60,
        semanticColors: {
          diffAdded: "#a7c080",
          diffRemoved: "#e67e80",
          skill: "#d699b6",
        },
        syntax: {
          comment: "#859289",
          string: "#dbbc7f",
          keyword: "#e67e80",
          function: "#a7c080",
          variable: "#d3c6aa",
          number: "#d699b6",
          operator: "#e69875",
          tag: "#e69875",
          attribute: "#dbbc7f",
          property: "#d3c6aa",
          type: "#7fbbb3",
          constant: "#d699b6",
        },
      },
      sourceName: "everforest-dark",
    },
  },
};
