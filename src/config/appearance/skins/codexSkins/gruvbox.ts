/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_GRUVBOX_SKIN: SkinDefinition = {
  id: "codex-gruvbox",
  label: "Gruvbox",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#fbf1c7",
        ink: "#3c3836",
        accent: "#458588",
        contrast: 45,
        semanticColors: {
          diffAdded: "#3c3836",
          diffRemoved: "#cc241d",
          skill: "#b16286",
        },
        syntax: {
          comment: "#928374",
          string: "#79740e",
          keyword: "#9d0006",
          function: "#b57614",
          variable: "#076678",
          number: "#8f3f71",
          operator: "#427b58",
          tag: "#427b58",
          attribute: "#b57614",
          property: "#689d6a",
          type: "#b57614",
          constant: "#8f3f71",
          invalid: "#cc241d",
        },
      },
      sourceName: "gruvbox-light-medium",
    },
    dark: {
      seed: {
        surface: "#282828",
        ink: "#ebdbb2",
        accent: "#458588",
        contrast: 60,
        semanticColors: {
          diffAdded: "#ebdbb2",
          diffRemoved: "#cc241d",
          skill: "#b16286",
        },
        syntax: {
          comment: "#928374",
          string: "#b8bb26",
          keyword: "#fb4934",
          function: "#fabd2f",
          variable: "#83a598",
          number: "#d3869b",
          operator: "#8ec07c",
          tag: "#8ec07c",
          attribute: "#fabd2f",
          property: "#689d6a",
          type: "#fabd2f",
          constant: "#d3869b",
          invalid: "#cc241d",
        },
      },
      sourceName: "gruvbox-dark-medium",
    },
  },
};
