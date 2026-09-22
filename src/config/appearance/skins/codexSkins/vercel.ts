/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_VERCEL_SKIN: SkinDefinition = {
  id: "codex-vercel",
  label: "Vercel",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#ffffff",
        ink: "#171717",
        accent: "#006aff",
        contrast: 40,
        semanticColors: {
          diffAdded: "#28a948",
          diffRemoved: "#eb001d",
          skill: "#a100f8",
        },
        syntax: {
          comment: "#666666",
          string: "#28a948",
          keyword: "#006aff",
          function: "#a100f8",
          variable: "#171717",
          number: "#a100f8",
          operator: "#666666",
          attribute: "#28a948",
          property: "#171717",
          type: "#0059d1",
          constant: "#a100f8",
        },
      },
      sourceName: "Vercel Light",
    },
    dark: {
      seed: {
        surface: "#000000",
        ink: "#ededed",
        accent: "#006efe",
        contrast: 50,
        semanticColors: {
          diffAdded: "#00ad3a",
          diffRemoved: "#f13342",
          skill: "#9540d5",
        },
        syntax: {
          comment: "#666666",
          string: "#00ad3a",
          keyword: "#006efe",
          function: "#9540d5",
          variable: "#ededed",
          number: "#9540d5",
          operator: "#a1a1a1",
          attribute: "#00ad3a",
          property: "#ededed",
          type: "#52a8ff",
          constant: "#9540d5",
        },
      },
      sourceName: "Vercel Dark",
    },
  },
};
