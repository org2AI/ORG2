import { useEffect } from "react";

import { buildSettingsPath } from "@src/config/mainAppPaths/settings";
import { ROUTES } from "@src/config/routes";
import { useAppNavigate } from "@src/hooks/navigation/useAppNavigate";

import UsageAuthorizationHost from "./UsageAuthorizationHost";
import {
  MARKET_AUTHORIZATION_SAVED_EVENT,
  MARKET_CONNECTION_OPEN_EVENT,
} from "./events";
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
    const authorized = (event: Event) => open(event);
    const manual = (event: Event) => open(event);
    window.addEventListener(MARKET_AUTHORIZATION_SAVED_EVENT, authorized);
    window.addEventListener(MARKET_CONNECTION_OPEN_EVENT, manual);
    return () => {
      window.removeEventListener(MARKET_AUTHORIZATION_SAVED_EVENT, authorized);
      window.removeEventListener(MARKET_CONNECTION_OPEN_EVENT, manual);
    };
  }, [navigate]);
  return <UsageAuthorizationHost />;
}
