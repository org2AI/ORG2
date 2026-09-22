/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_NORD_SKIN: SkinDefinition = {
  id: "codex-nord",
  label: "Nord",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#2e3440",
        ink: "#d8dee9",
        accent: "#88c0d0",
        contrast: 60,
        semanticColors: {
          diffAdded: "#a3be8c",
          diffRemoved: "#bf616a",
          skill: "#b48ead",
        },
        syntax: {
          comment: "#616e88",
          string: "#a3be8c",
          keyword: "#81a1c1",
          function: "#88c0d0",
          variable: "#d8dee9",
          number: "#b48ead",
          operator: "#81a1c1",
          tag: "#81a1c1",
          attribute: "#8fbcbb",
          property: "#8fbcbb",
          type: "#8fbcbb",
          constant: "#81a1c1",
          invalid: "#d8dee9",
        },
      },
      sourceName: "nord",
    },
  },
};
