/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_LINEAR_SKIN: SkinDefinition = {
  id: "codex-linear",
  label: "Linear",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#fcfcfd",
        ink: "#1b1b1b",
        accent: "#5e6ad2",
        contrast: 45,
        semanticColors: {
          diffAdded: "#52a450",
          diffRemoved: "#c94446",
          skill: "#8160d8",
        },
        syntax: {
          comment: "#8a93a6",
          string: "#0f8f83",
          keyword: "#5e6ad2",
          function: "#8160d8",
          variable: "#2a3140",
          number: "#b4831f",
          operator: "#6f7788",
          attribute: "#0f8f83",
          property: "#2a3140",
          type: "#4380d8",
          constant: "#b4831f",
        },
      },
      sourceName: "Linear Light",
    },
    dark: {
      seed: {
        surface: "#0f0f11",
        ink: "#e3e4e6",
        accent: "#606acc",
        contrast: 60,
        semanticColors: {
          diffAdded: "#69c967",
          diffRemoved: "#ff7e78",
          skill: "#c2a1ff",
        },
        syntax: {
          comment: "#636b7b",
          string: "#7ad9c0",
          keyword: "#8c97ff",
          function: "#c2a1ff",
          variable: "#e6e9ef",
          number: "#f5c56a",
          operator: "#b5bccb",
          attribute: "#7ad9c0",
          property: "#e6e9ef",
          type: "#73b7ff",
          constant: "#f5c56a",
        },
      },
      sourceName: "Linear Dark",
    },
  },
};
