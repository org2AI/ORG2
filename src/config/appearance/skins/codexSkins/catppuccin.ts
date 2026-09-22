/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_CATPPUCCIN_SKIN: SkinDefinition = {
  id: "codex-catppuccin",
  label: "Catppuccin",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#eff1f5",
        ink: "#4c4f69",
        accent: "#8839ef",
        contrast: 45,
        semanticColors: {
          diffAdded: "#40a02b",
          diffRemoved: "#d20f39",
          skill: "#8839ef",
        },
        syntax: {
          comment: "#7c7f93",
          string: "#40a02b",
          keyword: "#8839ef",
          function: "#1e66f5",
          variable: "#e64553",
          number: "#fe640b",
          operator: "#179299",
          tag: "#1e66f5",
          attribute: "#df8e1d",
          property: "#1e66f5",
          type: "#df8e1d",
          constant: "#d20f39",
        },
      },
      sourceName: "catppuccin-latte",
    },
    dark: {
      seed: {
        surface: "#1e1e2e",
        ink: "#cdd6f4",
        accent: "#cba6f7",
        contrast: 60,
        semanticColors: {
          diffAdded: "#a6e3a1",
          diffRemoved: "#f38ba8",
          skill: "#cba6f7",
        },
        syntax: {
          comment: "#9399b2",
          string: "#a6e3a1",
          keyword: "#cba6f7",
          function: "#89b4fa",
          variable: "#eba0ac",
          number: "#fab387",
          operator: "#94e2d5",
          tag: "#89b4fa",
          attribute: "#f9e2af",
          property: "#89b4fa",
          type: "#f9e2af",
          constant: "#f38ba8",
        },
      },
      sourceName: "catppuccin-mocha",
    },
  },
};
