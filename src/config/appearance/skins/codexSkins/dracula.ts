/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_DRACULA_SKIN: SkinDefinition = {
  id: "codex-dracula",
  label: "Dracula",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#282a36",
        ink: "#f8f8f2",
        accent: "#ff79c6",
        contrast: 60,
        semanticColors: {
          diffAdded: "#50fa7b",
          diffRemoved: "#ff5555",
          skill: "#ff79c6",
        },
        syntax: {
          comment: "#6272a4",
          string: "#f1fa8c",
          keyword: "#ff79c6",
          function: "#50fa7b",
          variable: "#f8f8f2",
          number: "#bd93f9",
          operator: "#50fa7b",
          tag: "#ff79c6",
          attribute: "#50fa7b",
          property: "#8be9fd",
          type: "#8be9fd",
          constant: "#bd93f9",
          invalid: "#ff5555",
        },
      },
      sourceName: "dracula",
    },
  },
};
