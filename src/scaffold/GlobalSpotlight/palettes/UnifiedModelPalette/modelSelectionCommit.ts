import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";

/** `false` means refused or superseded; void keeps creator callers compatible. */
export type ModelConfigChange = (
  config: AdvancedConfig
) => void | boolean | Promise<void | boolean>;

/** Keep the existing immediate dismissal, but remember only successful picks. */
export function commitModelSelection(options: {
  config: AdvancedConfig;
  entry: RecentModelEntry;
  apply: ModelConfigChange;
  record: (entry: RecentModelEntry) => void;
  close?: () => void;
  isCurrent: () => boolean;
  onError: (error: unknown) => void;
}): Promise<void> | void {
  try {
    const result = options.apply(options.config);
    if (result === false) return;
    if (result instanceof Promise) {
      options.close?.();
      return result
        .then((accepted) => {
          if (accepted !== false && options.isCurrent())
            options.record(options.entry);
        })
        .catch(options.onError);
    }
    if (options.isCurrent()) options.record(options.entry);
    options.close?.();
  } catch (error) {
    options.onError(error);
  }
}
