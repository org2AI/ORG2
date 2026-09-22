/**
 * Agent Station empty-state quick actions
 *
 * Mirrors the editor's placeholder actions (see EditorMainPane/config.ts) so
 * the "no active Agent session" surface offers a way out instead of a dead
 * line of text.
 */
import type { TFunction } from "i18next";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import type { QuickAction } from "@src/modules/WorkStation/shared";
import { openAgentSessionSearchSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";

export interface AgentStationQuickActionsOptions {
  /** Bound to the `common` namespace. */
  t: TFunction;
}

/** Creates quick actions for the Agent Station placeholder. */
export function createAgentStationQuickActions(
  options: AgentStationQuickActionsOptions
): QuickAction[] {
  const { t } = options;

  return [
    {
      id: "search-sessions",
      label: t("commands.searchSessions"),
      get shortcut() {
        return getShortcutKeys("agent_session_search");
      },
      onAction: () => openAgentSessionSearchSpotlight(),
    },
  ];
}
