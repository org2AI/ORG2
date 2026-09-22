/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_TEMPLE_SKIN: SkinDefinition = {
  id: "codex-temple",
  label: "Temple",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#02120c",
        ink: "#c7e6da",
        accent: "#e4f222",
        contrast: 60,
        semanticColors: {
          diffAdded: "#40c977",
          diffRemoved: "#fa423e",
          skill: "#e4f222",
        },
        syntax: {
          comment: "#394d46",
          string: "#e4f222",
          keyword: "#e4f222",
          function: "#e4f222",
          variable: "#c7e6da",
          number: "#e4f222",
          operator: "#788617",
          attribute: "#788617",
          property: "#c7e6da",
          type: "#859419",
          constant: "#e4f222",
        },
      },
      sourceName: "Temple Dark",
    },
  },
};
