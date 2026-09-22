/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_MATERIAL_SKIN: SkinDefinition = {
  id: "codex-material",
  label: "Material",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#212121",
        ink: "#eeffff",
        accent: "#80cbc4",
        contrast: 60,
        semanticColors: {
          diffAdded: "#c3e88d",
          diffRemoved: "#f07178",
          skill: "#c792ea",
        },
        syntax: {
          comment: "#545454",
          string: "#c3e88d",
          keyword: "#89ddff",
          function: "#82aaff",
          variable: "#eeffff",
          number: "#f78c6c",
          operator: "#89ddff",
          tag: "#f07178",
          attribute: "#c792ea",
          property: "#f07178",
          type: "#ffcb6b",
          constant: "#89ddff",
        },
      },
      sourceName: "material-theme-darker",
    },
  },
};
