import React, { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { InlineBanner } from "@src/components/InlineBanner";
import {
  ArrowLeft01Icon,
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  File01Icon,
  HelpCircleIcon,
  HugeiconsIcon,
  Logout02Icon,
  Shield01Icon,
  UserCircleIcon,
} from "@src/icons";
import Modal from "@src/scaffold/ModalSystem";

import { useMobileAuth } from "../../auth/MobileAuthContext";
import { useMobileAccountActions } from "../../auth/useMobileAccountActions";
import { MobileHeaderIconButton } from "../MobileHeaderIconButton";
import { MobileAccountAvatar } from "./MobileAccountAvatar";

export function MobileProfileSheet({
  name,
  onClose,
  onSignOut,
}: {
  name: string;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation("mobileRemote");
  const { session, isDevelopmentBypass } = useMobileAuth();
  const { opening, openFailed, openCloudPage } = useMobileAccountActions();
  const [page, setPage] = useState<"profile" | "help">("profile");
  const closeRef = useRef<HTMLButtonElement>(null);
  const title = t(page === "profile" ? "profile.title" : "profile.help");
  useLayoutEffect(() => {
    // The Help row unmounts during this transition. Keep keyboard focus inside
    // the existing Modal rather than letting it fall back to the page body.
    if (page === "help") closeRef.current?.focus();
  }, [page]);
  return (
    <Modal
      visible
      title={title}
      onClose={onClose}
      closable={false}
      className="mobile-profile-sheet"
      bodyClassName="mobile-profile-body"
      initialFocusRef={closeRef}
      headerActions={
        <MobileHeaderIconButton
          ref={closeRef}
          className="mobile-profile-close"
          label={t(page === "help" ? "profile.back" : "profile.close")}
          onClick={page === "help" ? () => setPage("profile") : onClose}
          icon={page === "help" ? ArrowLeft01Icon : Cancel01Icon}
        />
      }
    >
      {page === "help" ? (
        <div className="mobile-profile-help">
          <h2>{t("profile.pairingTitle")}</h2>
          <ol>
            <li>{t("profile.pairingStep1")}</li>
            <li>{t("profile.pairingStep2")}</li>
            <li>{t("profile.pairingStep3")}</li>
          </ol>
          <h2>{t("profile.connectionTitle")}</h2>
          <p>{t("profile.connectionHelp")}</p>
        </div>
      ) : (
        <>
          <div className="mobile-profile-identity">
            <MobileAccountAvatar
              name={name}
              src={session.profile?.avatarUrl}
              size={48}
            />
            <div className="min-w-0">
              <h2>{name}</h2>
              {session.profile?.primaryEmail?.trim() && (
                <p>{session.profile.primaryEmail.trim()}</p>
              )}
              {isDevelopmentBypass && <p>{t("profile.development")}</p>}
            </div>
          </div>
          {!isDevelopmentBypass && (
            <ProfileGroup title={t("settings.account")}>
              <ProfileRow
                label={t("settings.manageAccount")}
                icon={UserCircleIcon}
                external
                disabled={opening}
                onClick={() => void openCloudPage("/account")}
              />
              <ProfileRow
                label={t("settings.signOut")}
                icon={Logout02Icon}
                onClick={onSignOut}
              />
            </ProfileGroup>
          )}
          <ProfileGroup title={t("profile.helpAndAbout")}>
            <ProfileRow
              label={t("profile.help")}
              icon={HelpCircleIcon}
              onClick={() => setPage("help")}
            />
            <ProfileRow
              label={t("settings.privacyPolicy")}
              icon={Shield01Icon}
              external
              disabled={opening}
              onClick={() => void openCloudPage("/legal/privacy")}
            />
            <ProfileRow
              label={t("profile.terms")}
              icon={File01Icon}
              external
              disabled={opening}
              onClick={() => void openCloudPage("/legal/terms")}
            />
          </ProfileGroup>
          {!isDevelopmentBypass && (
            <ProfileGroup
              title={t("profile.danger")}
              hint={t("profile.deleteHint")}
            >
              <ProfileRow
                label={t("settings.deleteAccount")}
                icon={Delete02Icon}
                danger
                external
                disabled={opening}
                onClick={() => void openCloudPage("/account")}
              />
            </ProfileGroup>
          )}
          {opening && (
            <p role="status" className="mobile-profile-hint">
              {t("profile.opening")}
            </p>
          )}
          {openFailed && (
            <div role="alert">
              <InlineBanner tone="warning">
                {t("settings.openFailed")}
              </InlineBanner>
            </div>
          )}
          <p className="mobile-profile-brand">ORG2 Remote</p>
        </>
      )}
    </Modal>
  );
}

function ProfileGroup({
  title,
  children,
  hint,
}: React.PropsWithChildren<{ title: string; hint?: string }>) {
  return (
    <section className="mobile-profile-group" aria-label={title}>
      <h3>{title}</h3>
      <div className="mobile-profile-group-card">{children}</div>
      {hint ? <p className="mobile-profile-hint">{hint}</p> : null}
    </section>
  );
}

function ProfileRow({
  label,
  icon,
  onClick,
  external = false,
  danger = false,
  disabled = false,
}: {
  label: string;
  icon: React.ComponentProps<typeof HugeiconsIcon>["icon"];
  onClick: () => void;
  external?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      tone={danger ? "danger" : undefined}
      // Compound menu row: CSS owns icon/label/trailing-action columns and touch geometry.
      layout="custom"
      className={`mobile-profile-row ${danger ? "mobile-profile-row--danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="mobile-profile-row-content">
        <HugeiconsIcon icon={icon} size={20} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-left">{label}</span>
        <HugeiconsIcon
          icon={external ? ArrowUpRight01Icon : ArrowRight02Icon}
          size={18}
          aria-hidden="true"
        />
      </span>
    </Button>
  );
}
