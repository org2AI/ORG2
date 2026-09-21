import { createContext } from "react";

export interface VariantPillEditContextValue {
  /** Stage variant edits behind Cancel / Apply (spotlight palette only). */
  confirmChanges: boolean;
  /**
   * Reports each pill's popover opening and closing, keyed by a per-pill id,
   * so the host can hold its hover selection while an edit is open.
   */
  onEditingChange?: (pillId: string, open: boolean) => void;
}

/**
 * Lets the spotlight model palette opt its variant pills into staged edits.
 * The anchored model dropdown keeps the default immediate-apply popover.
 */
export const VariantPillEditContext =
  createContext<VariantPillEditContextValue>({ confirmChanges: false });
