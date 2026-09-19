import { openUrl } from "@tauri-apps/plugin-opener";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  SECTION_DESCRIPTION_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";
import { openOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";

import { marketOwnerKeyAtom } from "./identity";
import { connectSellerAccount } from "./sellerAuthorization";
import { marketConsoleUrl } from "./urlPolicy";

/** Supply authorization is independent of the buyer's selected model/client. */
export default function SellerSupplyPanel() {
  const { t } = useTranslation("settings");
  const owner = useAtomValue(marketOwnerKeyAtom);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "failed"
  >("idle");
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => {
    setStatus("idle");
    return () => {
      attempt.current?.abort();
      attempt.current = null;
    };
  }, [owner]);
  const connect = async (provider: "claude" | "codex") => {
    if (!owner) {
      await openOrg2CloudSignIn();
      return;
    }
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setStatus("connecting");
    try {
      await connectSellerAccount(provider, controller.signal);
      if (!controller.signal.aborted) setStatus("connected");
    } catch {
      if (!controller.signal.aborted) setStatus("failed");
    } finally {
      if (attempt.current === controller) {
        attempt.current = null;
        if (controller.signal.aborted) setStatus("idle");
      }
    }
  };
  return (
    <SectionContainer title={t("marketSupply.title", "Sell compute")}>
      <SectionRow showHeader={false}>
        <div className="space-y-3">
          <p className={SECTION_DESCRIPTION_CLASSES}>
            {t(
              "marketSupply.description",
              "Connect a subscription account to supply Market packages, then manage package participation on the Market website"
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={status === "connecting"}
              onClick={() => void connect("claude")}
            >
              {t("marketSupply.claude", "Connect Claude subscription")}
            </Button>
            <Button
              disabled={status === "connecting"}
              onClick={() => void connect("codex")}
            >
              {t("marketSupply.codex", "Connect Codex subscription")}
            </Button>
            {status === "connecting" && (
              <Button
                onClick={() => {
                  attempt.current?.abort();
                }}
              >
                {t("common:actions.cancel", "Cancel")}
              </Button>
            )}
            <Button
              variant="tertiary"
              onClick={() => void openUrl(marketConsoleUrl("/seller/accounts"))}
            >
              {t("marketSupply.manage", "Manage package participation")}
            </Button>
          </div>
          {status !== "idle" && (
            <p role="status" className={SECTION_DESCRIPTION_CLASSES}>
              {status === "connecting"
                ? t(
                    "marketSupply.connecting",
                    "Approve access in the provider browser tab; ORG2 will receive the result automatically"
                  )
                : status === "connected"
                  ? t(
                      "marketSupply.connected",
                      "Supply account connected. Choose its packages on the Market website"
                    )
                  : t(
                      "marketSupply.failed",
                      "Connection could not be confirmed. Check your Market accounts before retrying"
                    )}
            </p>
          )}
        </div>
      </SectionRow>
    </SectionContainer>
  );
}
