import { useContext } from "react";

import { GitStatusContext } from "./context";
import type { GitStatusContextValue } from "./types";

/** Read current repository state without importing its provider implementation. */
export function useGitStatus(): GitStatusContextValue {
  const context = useContext(GitStatusContext);
  if (!context) {
    throw new Error("useGitStatus must be used within GitStatusProvider");
  }
  return context;
}
