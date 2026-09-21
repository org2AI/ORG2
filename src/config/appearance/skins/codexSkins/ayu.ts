/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_AYU_SKIN: SkinDefinition = {
  id: "codex-ayu",
  label: "Ayu",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#10141c",
        ink: "#bfbdb6",
        accent: "#e6b450",
        contrast: 60,
        semanticColors: {
          diffAdded: "#70bf56",
          diffRemoved: "#f26d78",
          skill: "#d0a1ff",
        },
        syntax: {
          comment: "#5a6673",
          string: "#aad94c",
          keyword: "#ff8f40",
          function: "#ffb454",
          variable: "#bfbdb6",
          number: "#d2a6ff",
          operator: "#f29668",
          tag: "#39bae6",
          attribute: "#ffb454",
          property: "#39bae6",
          type: "#39bae6",
          constant: "#d2a6ff",
          invalid: "#d95757",
        },
      },
      sourceName: "ayu-dark",
    },
  },
};
