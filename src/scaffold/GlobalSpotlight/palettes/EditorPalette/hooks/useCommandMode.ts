import { useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { createLogger } from "@src/hooks/logger";
import { ACTION_ID } from "@src/scaffold/ActionSystem";
import type { TypedDispatch } from "@src/scaffold/ActionSystem/ActionSystemContext";
import { zodActionRegistry } from "@src/scaffold/ActionSystem/schema/zodRegistry";

import type { SpotlightItem } from "../../../shared";

// Only implemented, argument-free commands belong here. Find/go-to-line need
// parameter entry; format/fold actions currently have unimplemented services.
const COMMANDS = [
  { id: ACTION_ID.EDITOR_UNDO, labelKey: "common:windowChrome.items.undo" },
  { id: ACTION_ID.EDITOR_REDO, labelKey: "common:windowChrome.items.redo" },
  { id: ACTION_ID.FILE_CLOSE, labelKey: "common:actions.close" },
  { id: ACTION_ID.FILE_CLOSE_SAVED, labelKey: "common:actions.closeSaved" },
] as const;
const log = createLogger("EditorCommandPalette");
const subscribe = (notify: () => void) => zodActionRegistry.subscribe(notify);
const noSubscribe = () => () => {};
const getSnapshot = () =>
  COMMANDS.filter(({ id }) => zodActionRegistry.has(id))
    .map(({ id }) => id)
    .join("|");

interface UseCommandModeOptions {
  enabled: boolean;
  searchTerm: string;
  dispatch: TypedDispatch;
  onClose?: () => void;
}

export function useCommandMode({
  enabled,
  searchTerm,
  dispatch,
  onClose,
}: UseCommandModeOptions) {
  const { t } = useTranslation();
  const registeredIds = useSyncExternalStore(
    enabled ? subscribe : noSubscribe,
    getSnapshot,
    getSnapshot
  );
  const items = useMemo<SpotlightItem[]>(() => {
    if (!enabled) return [];
    const available = new Set(registeredIds.split("|"));
    const query = searchTerm.trim().toLocaleLowerCase();
    return COMMANDS.filter(({ id }) => available.has(id)).flatMap(
      ({ id, labelKey }) => {
        const label = t(labelKey);
        if (query && !`${label} ${id}`.toLocaleLowerCase().includes(query))
          return [];
        return [
          {
            id,
            label,
            type: "command" as const,
            shortcut: zodActionRegistry.get(id)?.meta.shortcut,
            action: () => {
              void dispatch(id, {}, "user")
                .then((result) => {
                  if (result.success) onClose?.();
                  else log.error("Editor command failed:", result.message);
                })
                .catch((error: unknown) =>
                  log.error("Editor command failed:", error)
                );
            },
          },
        ];
      }
    );
  }, [enabled, searchTerm, registeredIds, t, dispatch, onClose]);
  return { items, isLoading: false };
}
