import React from "react";
import { useTranslation } from "react-i18next";

import { Camera01Icon, HugeiconsIcon, SmartPhone01Icon } from "@src/icons";

import { MobileActionButton } from "../components/MobileActionButton";

export interface WelcomeScreenProps {
  onOpenPairing?: () => void;
  profileAction?: React.ReactNode;
}

/** M-01 Welcome / Unpaired */
export function WelcomeScreen({
  onOpenPairing,
  profileAction,
}: WelcomeScreenProps) {
  const { t } = useTranslation("mobileRemote");

  return (
    <>
      {profileAction && (
        <header className="shrink-0 px-6 pt-5">{profileAction}</header>
      )}
      <div className="mobile-flow-screen mobile-flow-screen--centered flex flex-1 flex-col items-center px-6 text-center">
        <div
          className="mobile-welcome-icon mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
          aria-hidden="true"
        >
          <HugeiconsIcon icon={SmartPhone01Icon} size={32} />
        </div>
        <h1 className="mobile-type-title mb-2 font-semibold text-text-1">
          {t("welcome.title")}
        </h1>
        <p className="mobile-type-secondary mb-10 text-text-3">
          {t("welcome.subtitle")}
        </p>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <MobileActionButton
            variant="primary"
            className="w-full"
            icon={
              <HugeiconsIcon icon={Camera01Icon} size={16} aria-hidden="true" />
            }
            onClick={onOpenPairing}
          >
            {t("welcome.scanQr")}
          </MobileActionButton>
        </div>
      </div>
    </>
  );
}

WelcomeScreen.displayName = "WelcomeScreen";
