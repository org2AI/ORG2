import { useCallback } from "react";
import { type NavigateOptions, type To, useNavigate } from "react-router-dom";

import { createLogger } from "@src/hooks/logger";

const logger = createLogger("Navigation");

export interface AppNavigateFunction {
  (to: To, options?: NavigateOptions): void;
  (delta: number): void;
}

/** UI navigation starts immediately; handle v7's completion rejection centrally. */
export function useAppNavigate(): AppNavigateFunction {
  const navigate = useNavigate();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      const completion =
        typeof to === "number"
          ? navigate(to)
          : options === undefined
            ? navigate(to)
            : navigate(to, options);
      completion?.catch((error: unknown) => {
        logger.error("Navigation failed", error);
      });
    },
    [navigate]
  );
}
