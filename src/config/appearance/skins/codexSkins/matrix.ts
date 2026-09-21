/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_MATRIX_SKIN: SkinDefinition = {
  id: "codex-matrix",
  label: "Matrix",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#040805",
        ink: "#b8ffca",
        accent: "#1eff5a",
        contrast: 60,
        semanticColors: {
          diffAdded: "#1eff5a",
          diffRemoved: "#fa423e",
          skill: "#1eff5a",
        },
        syntax: {
          comment: "#3f8f52",
          string: "#7dff95",
          keyword: "#1eff5a",
          function: "#9bffb8",
          variable: "#b8ffca",
          number: "#55ff7d",
          operator: "#6bd985",
          attribute: "#7dff95",
          property: "#b8ffca",
          type: "#3adf6a",
          constant: "#55ff7d",
        },
      },
      sourceName: "Matrix Dark",
    },
  },
};
