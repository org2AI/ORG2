/**
 * SessionCreatorChatPanel — native slash-control items.
 *
 * The builtin `/model`, `/effort`, `/fast`, `/plan` (plus composer command)
 * entries offered by the creator's slash menu. Hidden for Work log and the
 * Compare-runners launcher, where no single agent owns the controls.
 */
import type { TFunction } from "i18next";
import { useMemo } from "react";

import {
  COMPOSER_COMMAND_ACTIONS,
  buildNativeSlashItems,
} from "@src/engines/ChatPanel/hooks/useInputArea/nativeSlashCommands";

interface UseChatPanelNativeControlItemsOptions {
  isHumanMode: boolean;
  multiRunnerLauncher: boolean;
  t: TFunction<"sessions">;
}

export function useChatPanelNativeControlItems({
  isHumanMode,
  multiRunnerLauncher,
  t,
}: UseChatPanelNativeControlItemsOptions) {
  return useMemo(
    () =>
      isHumanMode || multiRunnerLauncher
        ? []
        : buildNativeSlashItems(
            [
              ...Object.keys(COMPOSER_COMMAND_ACTIONS),
              "model",
              "effort",
              "fast",
              "plan",
            ],
            (name) =>
              t("input.nativeCommandDescription", {
                command: `/${name}`,
                provider: "ORG2",
              }),
            "builtin"
          ),
    [isHumanMode, multiRunnerLauncher, t]
  );
}
