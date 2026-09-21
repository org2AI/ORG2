/**
 * Navigation Actions (Zod-based)
 *
 * Actions for code navigation (go to definition, find references, back/forward).
 * The operations themselves live in CodeNavigationService; these actions are
 * the ActionSystem surface over it, and report whatever it reports so the
 * command surfaces and the agent see the real outcome.
 */
import { z } from "zod";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { ACTION_ID } from "@src/scaffold/ActionSystem/actionIds";
import { defineZodAction } from "@src/scaffold/ActionSystem/schema/defineZodAction";
import { CodeNavigationService } from "@src/services/navigation";

// ============================================
// Navigation Actions
// ============================================

export const navigationGoToDefinition = defineZodAction(
  {
    id: ACTION_ID.NAVIGATION_GO_TO_DEFINITION,
    category: "navigation",
    layer: "gui",
    description: "Go to the definition of the symbol under cursor",
    params: z.object({}),
    get shortcut() {
      return getShortcutKeys("go_to_definition");
    },
    examples: ["go to definition", "jump to definition"],
  },
  async () => {
    const { ok, message } = await CodeNavigationService.goToDefinition();
    return { success: ok, message };
  }
);

export const navigationFindReferences = defineZodAction(
  {
    id: ACTION_ID.NAVIGATION_FIND_REFERENCES,
    category: "navigation",
    layer: "gui",
    description: "Find all references of the symbol under cursor",
    params: z.object({}),
    get shortcut() {
      return getShortcutKeys("find_references");
    },
    examples: ["find references", "find usages"],
  },
  async () => {
    const { ok, message } = await CodeNavigationService.findReferences();
    return { success: ok, message };
  }
);

export const navigationGoBack = defineZodAction(
  {
    id: ACTION_ID.NAVIGATION_GO_BACK,
    category: "navigation",
    layer: "gui",
    description: "Go back to previous location",
    params: z.object({}),
    get shortcut() {
      return getShortcutKeys("go_back");
    },
    examples: ["go back", "previous location"],
  },
  async () => {
    const { ok, message } = await CodeNavigationService.goBack();
    return { success: ok, message };
  }
);

export const navigationGoForward = defineZodAction(
  {
    id: ACTION_ID.NAVIGATION_GO_FORWARD,
    category: "navigation",
    layer: "gui",
    description: "Go forward to next location",
    params: z.object({}),
    get shortcut() {
      return getShortcutKeys("go_forward");
    },
    examples: ["go forward", "next location"],
  },
  async () => {
    const { ok, message } = await CodeNavigationService.goForward();
    return { success: ok, message };
  }
);

// ============================================
// Export all navigation actions
// ============================================

export const navigationZodActions = [
  navigationGoToDefinition,
  navigationFindReferences,
  navigationGoBack,
  navigationGoForward,
];
