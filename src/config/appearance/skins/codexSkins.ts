/**
 * Codex app skins.
 *
 * Seeds are extracted from the Codex desktop app's bundled theme registry and
 * reduced with Codex's own rules: `surface` and `ink` come from the first
 * present `editor.background` / `editor.foreground` (falling back through the
 * sideBar and panel keys), `accent` from the first sufficiently chromatic
 * `activityBarBadge.background` / `textLink.foreground` /
 * `editorCursor.foreground`, and the semantic hues from the matching
 * `gitDecoration.*` and `terminal.ansi*` entries. Partner themes (Linear,
 * Notion, Vercel, Raycast, Sentry, Xcode) ship an explicit `chromeTheme` seed,
 * which overrides the derived values verbatim.
 *
 * Syntax colors are the canonical scope for each category, preferring an exact
 * TextMate scope over a longer descendant of it.
 *
 * Each skin lives in its own module under `codexSkins/`. This list keeps the
 * order of the extracted registry, which the skin pickers follow.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import { CODEX_ABSOLUTELY_SKIN } from "./codexSkins/absolutely";
import { CODEX_AYU_SKIN } from "./codexSkins/ayu";
import { CODEX_CATPPUCCIN_SKIN } from "./codexSkins/catppuccin";
import { CODEX_CODEX_SKIN } from "./codexSkins/codex";
import { CODEX_DRACULA_SKIN } from "./codexSkins/dracula";
import { CODEX_EVERFOREST_SKIN } from "./codexSkins/everforest";
import { CODEX_GITHUB_SKIN } from "./codexSkins/github";
import { CODEX_GRUVBOX_SKIN } from "./codexSkins/gruvbox";
import { CODEX_LINEAR_SKIN } from "./codexSkins/linear";
import { CODEX_LOBSTER_SKIN } from "./codexSkins/lobster";
import { CODEX_MATERIAL_SKIN } from "./codexSkins/material";
import { CODEX_MATRIX_SKIN } from "./codexSkins/matrix";
import { CODEX_MONOKAI_SKIN } from "./codexSkins/monokai";
import { CODEX_NIGHT_OWL_SKIN } from "./codexSkins/night-owl";
import { CODEX_NORD_SKIN } from "./codexSkins/nord";
import { CODEX_NOTION_SKIN } from "./codexSkins/notion";
import { CODEX_ONE_SKIN } from "./codexSkins/one";
import { CODEX_OSCURANGE_SKIN } from "./codexSkins/oscurange";
import { CODEX_PROOF_SKIN } from "./codexSkins/proof";
import { CODEX_RAYCAST_SKIN } from "./codexSkins/raycast";
import { CODEX_ROSE_PINE_SKIN } from "./codexSkins/rose-pine";
import { CODEX_SENTRY_SKIN } from "./codexSkins/sentry";
import { CODEX_SOLARIZED_SKIN } from "./codexSkins/solarized";
import { CODEX_TEMPLE_SKIN } from "./codexSkins/temple";
import { CODEX_TOKYO_NIGHT_SKIN } from "./codexSkins/tokyo-night";
import { CODEX_VERCEL_SKIN } from "./codexSkins/vercel";
import { CODEX_VSCODE_PLUS_SKIN } from "./codexSkins/vscode-plus";
import { CODEX_XCODE_SKIN } from "./codexSkins/xcode";
import type { SkinDefinition } from "./types";

export const CODEX_SKINS: readonly SkinDefinition[] = [
  CODEX_AYU_SKIN,
  CODEX_CATPPUCCIN_SKIN,
  CODEX_ABSOLUTELY_SKIN,
  CODEX_CODEX_SKIN,
  CODEX_DRACULA_SKIN,
  CODEX_EVERFOREST_SKIN,
  CODEX_GITHUB_SKIN,
  CODEX_GRUVBOX_SKIN,
  CODEX_LINEAR_SKIN,
  CODEX_LOBSTER_SKIN,
  CODEX_MATERIAL_SKIN,
  CODEX_MATRIX_SKIN,
  CODEX_MONOKAI_SKIN,
  CODEX_NIGHT_OWL_SKIN,
  CODEX_NORD_SKIN,
  CODEX_NOTION_SKIN,
  CODEX_OSCURANGE_SKIN,
  CODEX_ONE_SKIN,
  CODEX_PROOF_SKIN,
  CODEX_RAYCAST_SKIN,
  CODEX_ROSE_PINE_SKIN,
  CODEX_SENTRY_SKIN,
  CODEX_SOLARIZED_SKIN,
  CODEX_TOKYO_NIGHT_SKIN,
  CODEX_TEMPLE_SKIN,
  CODEX_VERCEL_SKIN,
  CODEX_VSCODE_PLUS_SKIN,
  CODEX_XCODE_SKIN,
];
