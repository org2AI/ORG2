import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Modal from "@src/scaffold/ModalSystem";

import { MARKET_PROFILES_CHANGED_EVENT } from "./events";
import { marketConsoleUrl } from "./urlPolicy";
import {
  USAGE_AUTHORIZATION_CANCEL_EVENT,
  USAGE_AUTHORIZATION_EVENT,
  type UsagePrompt,
} from "./usageAuthorization";

export default function UsageAuthorizationHost() {
  const { t } = useTranslation("settings"),
    [prompt, setPrompt] = useState<UsagePrompt | null>(null);
  const pending = useRef<UsagePrompt | null>(null);
  useEffect(() => {
    const cancel = () => {
      pending.current?.resolve(false);
      pending.current = null;
      setPrompt(null);
    };
    const show = (event: Event) => {
      const next = (event as CustomEvent<UsagePrompt>).detail;
      if (pending.current) {
        next.resolve(false);
        return;
      }
      pending.current = next;
      setPrompt(next);
    };
    window.addEventListener(USAGE_AUTHORIZATION_EVENT, show);
    window.addEventListener(MARKET_PROFILES_CHANGED_EVENT, cancel);
    window.addEventListener(USAGE_AUTHORIZATION_CANCEL_EVENT, cancel);
    return () => {
      window.removeEventListener(USAGE_AUTHORIZATION_EVENT, show);
      window.removeEventListener(MARKET_PROFILES_CHANGED_EVENT, cancel);
      window.removeEventListener(USAGE_AUTHORIZATION_CANCEL_EVENT, cancel);
      cancel();
    };
  }, []);
  if (!prompt) return null;
  const close = (accepted: boolean) => {
    const current = pending.current;
    pending.current = null;
    setPrompt(null);
    current?.resolve(accepted);
  };
  const valid =
    !!prompt.service.price_range_bps &&
    prompt.service.wallet_billing_supported === true;
  const price = (rates: Record<string, unknown>, key: string) =>
    typeof rates[key] === "number"
      ? `$${((rates[key] as number) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })}`
      : "—";
  return (
    <Modal
      visible
      title={prompt.service.title}
      onClose={() => close(false)}
      width={500}
      onOk={() => close(true)}
      okText={t("managedUsage.authorize")}
      okButtonProps={{ disabled: !valid }}
      cancelText={t("managedUsage.cancel")}
    >
      <div className="space-y-4">
        {prompt.service.price_range_bps && (
          <p className="font-medium text-text-2">
            {t("managedUsage.priceRange", {
              min: prompt.service.price_range_bps.min / 100,
              max: prompt.service.price_range_bps.max / 100,
            })}
          </p>
        )}
        {!prompt.service.price_range_bps && (
          <p role="alert" className="text-sm text-text-3">
            {t("managedUsage.rangeUnavailable")}
          </p>
        )}
        <p className="text-sm text-text-2">
          {t("managedUsage.walletIncluded")}
        </p>
        <div className="max-h-64 space-y-3 overflow-y-auto">
          {prompt.service.models.map((model) => (
            <div key={model.model} className="space-y-1">
              <p className="font-medium">{model.model}</p>
              {model.pricing_range && (
                <p className="text-sm text-text-2">
                  {t("managedUsage.rates")}:{" "}
                  {price(model.pricing_range.min, "input_per_mtok_usd6")}–
                  {price(model.pricing_range.max, "input_per_mtok_usd6")} /{" "}
                  {price(model.pricing_range.min, "output_per_mtok_usd6")}–
                  {price(model.pricing_range.max, "output_per_mtok_usd6")}
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-text-3">{t("managedUsage.walletConsent")}</p>
        {!prompt.service.wallet_billing_supported && (
          <p role="alert" className="text-sm text-text-3">
            {t("managedUsage.walletUnavailable")}
          </p>
        )}
        <Button
          onClick={() => void openUrl(marketConsoleUrl("/buyer/billing"))}
        >
          {t("managedUsage.wallet")}
        </Button>
      </div>
    </Modal>
  );
}
