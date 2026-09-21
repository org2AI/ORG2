/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_ONE_SKIN: SkinDefinition = {
  id: "codex-one",
  label: "One",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#fafafa",
        ink: "#383a42",
        accent: "#526fff",
        contrast: 45,
        semanticColors: {
          diffAdded: "#3bba54",
          diffRemoved: "#ba2623",
          skill: "#526fff",
        },
        syntax: {
          comment: "#a0a1a7",
          string: "#50a14f",
          keyword: "#a626a4",
          function: "#4078f2",
          variable: "#e45649",
          number: "#986801",
          operator: "#383a42",
          tag: "#e45649",
          attribute: "#986801",
          property: "#383a42",
          type: "#c18401",
          constant: "#986801",
          invalid: "#50a14f",
        },
      },
      sourceName: "one-light",
    },
    dark: {
      seed: {
        surface: "#282c34",
        ink: "#abb2bf",
        accent: "#4d78cc",
        contrast: 60,
        semanticColors: {
          diffAdded: "#8cc265",
          diffRemoved: "#e05561",
          skill: "#c162de",
        },
        syntax: {
          comment: "#7f848e",
          string: "#98c379",
          keyword: "#c678dd",
          function: "#61afef",
          variable: "#e06c75",
          number: "#d19a66",
          operator: "#abb2bf",
          tag: "#e06c75",
          attribute: "#d19a66",
          property: "#abb2bf",
          type: "#e5c07b",
          constant: "#56b6c2",
          invalid: "#ffffff",
        },
      },
      sourceName: "one-dark-pro",
    },
  },
};
