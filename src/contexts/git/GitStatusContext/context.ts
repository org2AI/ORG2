import { createContext } from "react";

import type { GitStatusContextValue } from "./types";

/** Shared by deferred and active providers without importing their lifecycle. */
export const GitStatusContext = createContext<GitStatusContextValue | null>(
  null
);
