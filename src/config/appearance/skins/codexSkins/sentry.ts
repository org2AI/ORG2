/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_SENTRY_SKIN: SkinDefinition = {
  id: "codex-sentry",
  label: "Sentry",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#2d2935",
        ink: "#e6dff9",
        accent: "#7055f6",
        contrast: 60,
        semanticColors: {
          diffAdded: "#40c977",
          diffRemoved: "#fa423e",
          skill: "#7055f6",
        },
        syntax: {
          comment: "#8d849f",
          string: "#8ee6d7",
          keyword: "#7055f6",
          function: "#a58cff",
          variable: "#e6dff9",
          number: "#f4c46a",
          operator: "#c8bedf",
          attribute: "#8ee6d7",
          property: "#e6dff9",
          type: "#c39bff",
          constant: "#f4c46a",
        },
      },
      sourceName: "Sentry Dark",
    },
  },
};
