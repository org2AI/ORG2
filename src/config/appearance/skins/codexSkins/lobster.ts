/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_LOBSTER_SKIN: SkinDefinition = {
  id: "codex-lobster",
  label: "Lobster",
  source: "codex",
  variants: {
    dark: {
      seed: {
        surface: "#111827",
        ink: "#e4e4e7",
        accent: "#ff5c5c",
        contrast: 60,
        semanticColors: {
          diffAdded: "#40c977",
          diffRemoved: "#ff5c5c",
          skill: "#ff5c5c",
        },
        syntax: {
          comment: "#71717a",
          string: "#14b8a6",
          keyword: "#ff5c5c",
          function: "#22c55e",
          variable: "#e4e4e7",
          number: "#f59e0b",
          operator: "#ff7070",
          attribute: "#14b8a6",
          property: "#e4e4e7",
          type: "#3b82f6",
          constant: "#f59e0b",
          invalid: "#ff5c5c",
        },
      },
      sourceName: "Lobster Dark",
    },
  },
};
