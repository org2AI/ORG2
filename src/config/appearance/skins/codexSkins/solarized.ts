/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_SOLARIZED_SKIN: SkinDefinition = {
  id: "codex-solarized",
  label: "Solarized",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#fdf6e3",
        ink: "#657b83",
        accent: "#b58900",
        contrast: 45,
        semanticColors: {
          diffAdded: "#859900",
          diffRemoved: "#dc322f",
          skill: "#d33682",
        },
        syntax: {
          comment: "#93a1a1",
          string: "#2aa198",
          keyword: "#859900",
          function: "#268bd2",
          variable: "#268bd2",
          number: "#d33682",
          operator: "#859900",
          tag: "#268bd2",
          attribute: "#93a1a1",
          property: "#859900",
          type: "#cb4b16",
          constant: "#b58900",
          invalid: "#dc322f",
        },
      },
      sourceName: "solarized-light",
    },
    dark: {
      seed: {
        surface: "#002b36",
        ink: "#839496",
        accent: "#d30102",
        contrast: 60,
        semanticColors: {
          diffAdded: "#859900",
          diffRemoved: "#dc322f",
          skill: "#d33682",
        },
        syntax: {
          comment: "#586e75",
          string: "#2aa198",
          keyword: "#859900",
          function: "#268bd2",
          variable: "#268bd2",
          number: "#d33682",
          operator: "#859900",
          tag: "#268bd2",
          attribute: "#93a1a1",
          property: "#859900",
          type: "#cb4b16",
          constant: "#b58900",
          invalid: "#dc322f",
        },
      },
      sourceName: "solarized-dark",
    },
  },
};
