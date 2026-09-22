/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

export const CODEX_VSCODE_PLUS_SKIN: SkinDefinition = {
  id: "codex-vscode-plus",
  label: "VS Code Plus",
  source: "codex",
  variants: {
    light: {
      seed: {
        surface: "#ffffff",
        ink: "#000000",
        accent: "#007acc",
        contrast: 45,
        semanticColors: {
          diffAdded: "#369432",
          diffRemoved: "#c72e0f",
          skill: "#90c2f9",
        },
        syntax: {
          comment: "#008000",
          string: "#a31515",
          keyword: "#0000ff",
          function: "#795e26",
          variable: "#001080",
          number: "#098658",
          operator: "#000000",
          tag: "#800000",
          attribute: "#e50000",
          property: "#e50000",
          type: "#267f99",
          constant: "#0000ff",
          invalid: "#cd3131",
        },
      },
      sourceName: "light-plus",
    },
    dark: {
      seed: {
        surface: "#1e1e1e",
        ink: "#d4d4d4",
        accent: "#007acc",
        contrast: 60,
        semanticColors: {
          diffAdded: "#369432",
          diffRemoved: "#fa423e",
          skill: "#add6ff",
        },
        syntax: {
          comment: "#6a9955",
          string: "#ce9178",
          keyword: "#569cd6",
          function: "#dcdcaa",
          variable: "#9cdcfe",
          number: "#b5cea8",
          operator: "#d4d4d4",
          tag: "#569cd6",
          attribute: "#9cdcfe",
          property: "#9cdcfe",
          type: "#4ec9b0",
          constant: "#569cd6",
          invalid: "#f44747",
        },
      },
      sourceName: "dark-plus",
    },
  },
};
