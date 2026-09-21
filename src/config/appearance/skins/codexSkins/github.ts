/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_GITHUB_SKIN: SkinDefinition = {
  id: "codex-github",
  label: "GitHub",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#ffffff",
        ink: "#1f2328",
        accent: "#0969da",
        contrast: 45,
        semanticColors: {
          diffAdded: "#1a7f37",
          diffRemoved: "#cf222e",
          skill: "#8250df",
        },
        syntax: {
          comment: "#6e7781",
          string: "#0a3069",
          keyword: "#cf222e",
          function: "#8250df",
          variable: "#953800",
          number: "#0550ae",
          operator: "#cf222e",
          tag: "#116329",
          attribute: "#0550ae",
          property: "#116329",
          type: "#116329",
          constant: "#0550ae",
          invalid: "#82071e",
        },
      },
      sourceName: "github-light-default",
    },
    dark: {
      seed: {
        surface: "#0d1117",
        ink: "#e6edf3",
        accent: "#1f6feb",
        contrast: 60,
        semanticColors: {
          diffAdded: "#3fb950",
          diffRemoved: "#f85149",
          skill: "#bc8cff",
        },
        syntax: {
          comment: "#8b949e",
          string: "#a5d6ff",
          keyword: "#ff7b72",
          function: "#d2a8ff",
          variable: "#ffa657",
          number: "#79c0ff",
          operator: "#ff7b72",
          tag: "#7ee787",
          attribute: "#79c0ff",
          property: "#7ee787",
          type: "#7ee787",
          constant: "#79c0ff",
          invalid: "#ffa198",
        },
      },
      sourceName: "github-dark-default",
    },
  },
};
