/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_MONOKAI_SKIN: SkinDefinition = {
  id: "codex-monokai",
  label: "Monokai",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#272822",
        ink: "#f8f8f2",
        accent: "#99947c",
        contrast: 60,
        semanticColors: {
          diffAdded: "#86b42b",
          diffRemoved: "#c4265e",
          skill: "#8c6bc8",
        },
        syntax: {
          comment: "#88846f",
          string: "#e6db74",
          keyword: "#f92672",
          function: "#a6e22e",
          variable: "#f8f8f2",
          number: "#ae81ff",
          operator: "#f92672",
          tag: "#f92672",
          attribute: "#a6e22e",
          property: "#66d9ef",
          type: "#a6e22e",
          constant: "#ae81ff",
          invalid: "#f44747",
        },
      },
      sourceName: "monokai",
    },
  },
};
