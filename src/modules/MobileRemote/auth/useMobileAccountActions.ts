import { useEffect, useRef, useState } from "react";

import { ORG2_CLOUD_OFFICIAL_WEB_ORIGIN } from "@src/features/Org2Cloud/config";

import { useMobileRemotePlatform } from "../platform";

type AccountPage = "/account" | "/legal/privacy" | "/legal/terms";

/** Shared by Settings and Profile; external navigation never carries auth tokens. */
export function useMobileAccountActions() {
  const platform = useMobileRemotePlatform();
  const [state, setState] = useState<"idle" | "opening" | "failed">("idle");
  const attemptRef = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      attemptRef.current = null;
    },
    []
  );

  const openCloudPage = async (path: AccountPage) => {
    if (attemptRef.current) return;
    const attempt = Symbol("open-account-page");
    attemptRef.current = attempt;
    setState("opening");
    try {
      await platform.openExternal(
        new URL(path, ORG2_CLOUD_OFFICIAL_WEB_ORIGIN).href
      );
      if (attemptRef.current === attempt) setState("idle");
    } catch {
      if (attemptRef.current === attempt) setState("failed");
    } finally {
      if (attemptRef.current === attempt) attemptRef.current = null;
    }
  };
  return {
    opening: state === "opening",
    openFailed: state === "failed",
    openCloudPage,
  };
}
