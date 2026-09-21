/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_ROSE_PINE_SKIN: SkinDefinition = {
  id: "codex-rose-pine",
  label: "Rose Pine",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#faf4ed",
        ink: "#575279",
        accent: "#d7827e",
        contrast: 45,
        semanticColors: {
          diffAdded: "#56949f",
          diffRemoved: "#797593",
          skill: "#907aa9",
        },
        syntax: {
          comment: "#9893a5",
          string: "#ea9d34",
          keyword: "#286983",
          function: "#b4637a",
          variable: "#d7827e",
          number: "#d7827e",
          operator: "#286983",
          tag: "#56949f",
          attribute: "#907aa9",
          property: "#575279",
          type: "#56949f",
          constant: "#d7827e",
          invalid: "#b4637a",
        },
      },
      sourceName: "rose-pine-dawn",
    },
    dark: {
      seed: {
        surface: "#232136",
        ink: "#e0def4",
        accent: "#ea9a97",
        contrast: 60,
        semanticColors: {
          diffAdded: "#9ccfd8",
          diffRemoved: "#908caa",
          skill: "#c4a7e7",
        },
        syntax: {
          comment: "#6e6a86",
          string: "#f6c177",
          keyword: "#3e8fb0",
          function: "#eb6f92",
          variable: "#ea9a97",
          number: "#ea9a97",
          operator: "#3e8fb0",
          tag: "#9ccfd8",
          attribute: "#c4a7e7",
          property: "#e0def4",
          type: "#9ccfd8",
          constant: "#ea9a97",
          invalid: "#eb6f92",
        },
      },
      sourceName: "rose-pine-moon",
    },
  },
};
