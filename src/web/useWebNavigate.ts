import { useCallback } from "react";
import { type NavigateOptions, type To, useNavigate } from "react-router-dom";

import { createLogger } from "@src/hooks/logger";

const log = createLogger("WebNavigation");

/** Router navigation can be asynchronous; UI callbacks share one rejection owner. */
export function useWebNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (...args: [to: To, options?: NavigateOptions]): void => {
      void Promise.resolve(navigate(...args)).catch((error) =>
        log.error("Browser navigation failed", error)
      );
    },
    [navigate]
  );
}
