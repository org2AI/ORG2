import { useEffect } from "react";

import { buildSettingsPath } from "@src/config/mainAppPaths/settings";
import { ROUTES } from "@src/config/routes";
import { useAppNavigate } from "@src/hooks/navigation/useAppNavigate";

import UsageAuthorizationHost from "./UsageAuthorizationHost";
import { MARKET_CONNECTION_OPEN_EVENT } from "./events";
import { connectionSchema } from "./rpc";

export default function ConnectionHost() {
  const navigate = useAppNavigate();
  useEffect(() => {
    const open = (event: Event) => {
      const value = connectionSchema.safeParse((event as CustomEvent).detail);
      if (value.success) {
        navigate(
          value.data.target === "org2"
            ? ROUTES.workStation.base.path
            : buildSettingsPath({ section: "harness-connections" })
        );
      }
    };
    window.addEventListener(MARKET_CONNECTION_OPEN_EVENT, open);
    return () => {
      window.removeEventListener(MARKET_CONNECTION_OPEN_EVENT, open);
    };
  }, [navigate]);
  return <UsageAuthorizationHost />;
}
