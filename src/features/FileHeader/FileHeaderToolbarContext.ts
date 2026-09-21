import { createContext } from "react";

/** A host may supply its own menu or a destination for the active file's menu. */
export const FileHeaderToolbarContext = createContext<
  HTMLElement | "host" | null
>(null);
