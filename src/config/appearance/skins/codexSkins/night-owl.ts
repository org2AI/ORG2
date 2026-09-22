/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_NIGHT_OWL_SKIN: SkinDefinition = {
  id: "codex-night-owl",
  label: "Night Owl",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#011627",
        ink: "#d6deeb",
        accent: "#44596b",
        contrast: 60,
        semanticColors: {
          diffAdded: "#c5e478",
          diffRemoved: "#ef5350",
          skill: "#c792ea",
        },
        syntax: {
          comment: "#637777",
          string: "#ecc48d",
          keyword: "#c792ea",
          function: "#c792ea",
          variable: "#c5e478",
          number: "#f78c6c",
          operator: "#7fdbca",
          tag: "#caece6",
          attribute: "#c5e478",
          property: "#80cbc4",
          type: "#c5e478",
          constant: "#82aaff",
          invalid: "#ffffff",
        },
      },
      sourceName: "night-owl",
    },
  },
};
