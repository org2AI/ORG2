/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_NOTION_SKIN: SkinDefinition = {
  id: "codex-notion",
  label: "Notion",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#ffffff",
        ink: "#37352f",
        accent: "#3183d8",
        contrast: 45,
        semanticColors: {
          diffAdded: "#00a240",
          diffRemoved: "#ba2623",
          skill: "#3183d8",
        },
        syntax: {
          comment: "#008000",
          string: "#a31515",
          keyword: "#0000ff",
          function: "#795e26",
          variable: "#37352f",
          number: "#098658",
          operator: "#37352f",
          property: "#37352f",
          type: "#267f99",
          constant: "#098658",
        },
      },
      sourceName: "Notion Light",
    },
    dark: {
      seed: {
        surface: "#191919",
        ink: "#d9d9d8",
        accent: "#3183d8",
        contrast: 60,
        semanticColors: {
          diffAdded: "#40c977",
          diffRemoved: "#fa423e",
          skill: "#3183d8",
        },
        syntax: {
          comment: "#6a9955",
          string: "#ce9178",
          keyword: "#569cd6",
          function: "#dcdcaa",
          variable: "#d9d9d8",
          number: "#b5cea8",
          operator: "#d4d4d4",
          property: "#d9d9d8",
          type: "#4ec9b0",
          constant: "#b5cea8",
        },
      },
      sourceName: "Notion Dark",
    },
  },
};
