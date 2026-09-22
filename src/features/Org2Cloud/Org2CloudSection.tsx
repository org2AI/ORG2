/**
 * ORG2 login rows (cloud design §20.1 + §4.2).
 *
 * Rendered as the first rows of General's first `SectionContainer`, above
 * language. Sign-in opens the managed cloud login page in the SYSTEM browser;
 * the login page finishes through an ephemeral localhost receiver, which the
 * OAuth plugin delivers to useDeepLinkHandler at the always-mounted app root.
 * Installed-app custom-scheme callbacks remain supported for cold-start
 * compatibility.
 */
import {
  SECTION_ACTION_GAP_CLASSES,
  SECTION_CONTROL_STYLE,
  SectionRow,
} from "@/src/components/layout/Section";
import { useAtom, useStore } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import RefreshButton from "@src/components/Button/RefreshButton";
import Input from "@src/components/Input";
import Message from "@src/components/Message";
import { SignInModal } from "@src/features/Org2Cloud/SignInModal";
import { importBundledOrg2CloudAuthForDev } from "@src/features/Org2Cloud/devBundledAuthImport";
import {
  commitRefreshedAuth,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import {
  ensureFreshSession,
  updateCloudProfileDisplayName,
} from "@src/features/Org2Cloud/org2CloudClient";
import { resetOrgEntitlementCoordinator } from "@src/features/Org2Cloud/org2CloudEntitlementCoordinator";
import { useOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";
import { createLogger } from "@src/hooks/logger";

import { SignOutConfirmationModal } from "./SignOutConfirmationModal";

const log = createLogger("Org2CloudSection");

export const Org2CloudLoginRows: React.FC = () => {
  const { t } = useTranslation(["navigation", "common"]);
  const [auth, setAuth] = useAtom(org2CloudAuthAtom);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false);
  const [isRefreshingDevAuth, setIsRefreshingDevAuth] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const store = useStore();
  const savedDisplayName = auth?.profile?.displayName ?? "";
  const displayNameValue = renameDraft ?? savedDisplayName;
  const trimmedDisplayName = displayNameValue.trim();

  const handleSignIn = useOrg2CloudSignIn();

  const handleSaveRename = useCallback(async () => {
    const trimmed = (renameDraft ?? "").trim();
    if (!auth || !trimmed || trimmed.length > 64 || isSavingRename) return;
    setIsSavingRename(true);
    try {
      const fresh = await ensureFreshSession(auth);
      if (!fresh) {
        Message.error(t("cloud.renameFailed"));
        return;
      }
      commitRefreshedAuth(setAuth, auth, fresh);
      const stored = await updateCloudProfileDisplayName(
        fresh.accessToken,
        trimmed
      );
      if (stored === null) {
        Message.error(t("cloud.renameFailed"));
        return;
      }
      setAuth((current) =>
        current
          ? {
              ...current,
              profile: { ...current.profile, displayName: stored },
            }
          : current
      );
      setRenameDraft(null);
      Message.success(t("cloud.renameSaved"));
    } finally {
      setIsSavingRename(false);
    }
  }, [auth, isSavingRename, renameDraft, setAuth, t]);

  const handleRefreshDevAuth = useCallback(async () => {
    if (isRefreshingDevAuth) return;
    setIsRefreshingDevAuth(true);
    try {
      const bundledAuth = await importBundledOrg2CloudAuthForDev();
      const currentIdentity = auth ? org2CloudAuthIdentityKey(auth) : null;
      const bundledIdentity = bundledAuth
        ? org2CloudAuthIdentityKey(bundledAuth)
        : null;
      if (currentIdentity !== bundledIdentity) {
        resetOrgEntitlementCoordinator(store);
      }
      setAuth(bundledAuth);
      if (bundledAuth) {
        Message.success(t("cloud.signedInToast"));
      } else {
        Message.info(t("common:errors.notFound"));
      }
    } catch (error: unknown) {
      log.error("failed to refresh ORG2 Cloud auth from bundled app", error);
      Message.error(t("common:errors.unknownError"));
    } finally {
      setIsRefreshingDevAuth(false);
    }
  }, [auth, isRefreshingDevAuth, setAuth, store, t]);

  const refreshDevAuthButton = process.env.NODE_ENV === "development" && (
    <RefreshButton
      variant="secondary"
      iconOnly
      label={t("common:actions.refresh")}
      refreshing={isRefreshingDevAuth}
      onRefresh={() => void handleRefreshDevAuth()}
      dataTestId="org2-cloud-refresh-dev-auth"
    />
  );

  return (
    <>
      {showSignInModal && (
        <SignInModal
          onClose={() => setShowSignInModal(false)}
          onSignIn={handleSignIn}
        />
      )}
      {showSignOutConfirmation && (
        <SignOutConfirmationModal
          onClose={() => setShowSignOutConfirmation(false)}
        />
      )}
      <SectionRow
        label={
          auth
            ? t("settings:general.loggedIn")
            : t("settings:general.notLoggedIn")
        }
      >
        <div className={SECTION_ACTION_GAP_CLASSES}>
          {auth ? (
            <>
              {refreshDevAuthButton}
              <Button
                onClick={() => setShowSignOutConfirmation(true)}
                data-testid="org2-cloud-sign-out"
              >
                {t("cloud.signOut")}
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => setShowSignInModal(true)}
                data-testid="org2-cloud-sign-in"
              >
                {t("cloud.signIn")}
              </Button>
              {refreshDevAuthButton}
            </>
          )}
        </div>
      </SectionRow>
      {auth && (
        <SectionRow label={t("cloud.userName")}>
          <Input
            value={displayNameValue}
            savedValue={savedDisplayName}
            onChange={(value) => setRenameDraft(value)}
            maxLength={64}
            placeholder={auth.profile?.primaryEmail ?? auth.userId}
            aria-label={t("cloud.renameDisplayName")}
            style={SECTION_CONTROL_STYLE}
            data-testid="org2-cloud-rename-input"
            onConfirm={() => void handleSaveRename()}
            onCancel={() => setRenameDraft(null)}
            confirmDisabled={
              !trimmedDisplayName || trimmedDisplayName === savedDisplayName
            }
            confirmLoading={isSavingRename}
          />
        </SectionRow>
      )}
    </>
  );
};

export default Org2CloudLoginRows;
