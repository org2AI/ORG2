import React, { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { ArrowRight02Icon, HugeiconsIcon } from "@src/icons";

import { useMobileAuth } from "../../auth/MobileAuthContext";
import { MobileConfirmModal } from "../modals/MobileConfirmModal";
import { MobileAccountAvatar } from "./MobileAccountAvatar";
import { MobileProfileSheet } from "./MobileProfileSheet";
import "./mobileProfile.scss";

export function MobileProfileEntry({
  variant = "avatar",
}: {
  variant?: "avatar" | "row";
}) {
  const { session } = useMobileAuth();
  // A changed account/endpoint drops all old overlay intent before any action can fire.
  return (
    <ProfileEntry
      key={JSON.stringify([session.supabaseUrl, session.userId])}
      variant={variant}
    />
  );
}

function ProfileEntry({ variant }: { variant: "avatar" | "row" }) {
  const { t } = useTranslation("mobileRemote");
  const { session, signOut, isDevelopmentBypass } = useMobileAuth();
  const [view, setView] = useState<"closed" | "profile" | "sign_out">("closed");
  const trigger = useRef<HTMLButtonElement>(null);
  const name =
    session.profile?.displayName?.trim() ||
    session.profile?.primaryEmail?.trim() ||
    t("profile.fallbackName");
  const close = () => {
    flushSync(() => setView("closed"));
    trigger.current?.focus();
  };
  return (
    <>
      {variant === "row" ? (
        <Button
          ref={trigger}
          variant="tertiary"
          long
          className="mobile-profile-settings-entry"
          style={{
            height: "auto",
            minHeight: "var(--mobile-touch-size)",
            padding: "calc(var(--spacing) * 3) 0",
          }}
          aria-label={`${name} · ${t("profile.title")}`}
          aria-haspopup="dialog"
          onClick={() => setView("profile")}
        >
          <span className="flex w-full min-w-0 items-center gap-3 text-left">
            <MobileAccountAvatar
              name={name}
              src={session.profile?.avatarUrl}
              size={32}
            />
            <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
            <span className="mobile-type-caption shrink-0 whitespace-nowrap text-text-3">
              {t("profile.title")}
            </span>
            <HugeiconsIcon
              icon={ArrowRight02Icon}
              size={16}
              aria-hidden="true"
            />
          </span>
        </Button>
      ) : (
        <Button
          variant="tertiary"
          shape="circle"
          iconOnly
          ref={trigger}
          className="mobile-profile-trigger"
          style={{
            width: "var(--mobile-profile-trigger-size)",
            height: "var(--mobile-profile-trigger-size)",
            padding: "var(--mobile-profile-trigger-padding)",
          }}
          aria-label={t("profile.open")}
          aria-haspopup="dialog"
          onClick={() => setView("profile")}
          icon={
            <MobileAccountAvatar name={name} src={session.profile?.avatarUrl} />
          }
        />
      )}
      {view === "profile" && (
        <MobileProfileSheet
          name={name}
          onClose={close}
          onSignOut={() => setView("sign_out")}
        />
      )}
      {view === "sign_out" && !isDevelopmentBypass && (
        <MobileConfirmModal
          title={t("settings.signOutConfirmTitle")}
          description={t("settings.signOutConfirmBody")}
          cancelLabel={t("settings.cancel")}
          confirmLabel={t("settings.signOut")}
          danger
          onDismiss={() => setView("profile")}
          onConfirm={() => {
            close();
            signOut();
          }}
        />
      )}
    </>
  );
}
