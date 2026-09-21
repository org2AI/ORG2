/** Billing reuses the login center's browser session. Desktop tokens stay local. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback } from "react";

import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import i18n from "@src/i18n";

import type { SetOrg2CloudAuth } from "./completeSignIn";
import { buildCloudBillingLoginUrl } from "./config";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";

const log = createLogger("Org2CloudBilling");

// Optional arguments retain compatibility with existing call sites; billing
// needs only the current web origin and never reads or rotates desktop auth.
export async function openCloudBilling(
  _auth?: Org2CloudAuthState | null,
  _setAuth?: SetOrg2CloudAuth
): Promise<void> {
  try {
    await openUrl(buildCloudBillingLoginUrl());
  } catch (error) {
    log.error("failed to open ORG2 Cloud billing in system browser", error);
    Message.error(i18n.t("navigation:cloud.billing.openFailed"));
  }
}
export function useOpenCloudBilling(): () => void {
  return useCallback(() => {
    void openCloudBilling().catch((error: unknown) => {
      log.error("unexpected Cloud billing failure", error);
    });
  }, []);
}
