import { createContext, useContext } from "react";

/** Kept in the mounted replay scope, never encoded in a portable file URL. */
export interface SharedSessionFileAccess {
  endpoint: string;
  shareToken: string;
}

export const SharedSessionFileAccessContext =
  createContext<SharedSessionFileAccess | null>(null);

export function useSharedSessionFileAccess(): SharedSessionFileAccess | null {
  return useContext(SharedSessionFileAccessContext);
}
