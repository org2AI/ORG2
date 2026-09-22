/**
 * useCloudSessionActions — dependencies shared by the replay and fork
 * actions: translation, store, auth-by-ref + fresh JWT, the per-row busy
 * registry setters, download-progress setters, and the tab/session surfaces.
 */
import type { TFunction } from "i18next";
import { type ExtractAtomArgs, useAtom, useSetAtom, useStore } from "jotai";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { openOrReplaceSessionInChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";

import {
  beginCloudSessionBusyAtom,
  endCloudSessionBusyAtom,
  updateCloudSessionBusyAtom,
} from "./cloudSessionBusyAtom";
import {
  clearCloudSessionDownloadProgressAtom,
  upsertCloudSessionDownloadProgressAtom,
} from "./cloudSessionDownloadProgressAtom";
import {
  type Org2CloudAuthState,
  commitRefreshedAuth,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { ensureFreshSession } from "./org2CloudClient";
import { useOpenCloudBilling } from "./useOpenCloudBilling";

/** Write signature of a jotai write-only atom, as `useSetAtom` returns it. */
type AtomSetter<A> = (...args: ExtractAtomArgs<A>) => void;

export type CloudSessionActionStore = ReturnType<typeof useStore>;

export interface CloudSessionActionDeps {
  orgId: string | null;
  t: TFunction<"navigation">;
  store: CloudSessionActionStore;
  /** Latest auth via ref so token-refresh writes don't recreate callbacks. */
  authRef: RefObject<Org2CloudAuthState | null>;
  authIdentityKey: string | null;
  /** Fresh JWT for a user action (same refresh idiom as the panel). */
  freshAccessToken: () => Promise<string | null>;
  notifyRetentionExpired: () => void;
  openOrReplaceSessionTab: AtomSetter<
    typeof openOrReplaceSessionInChatPanelTabAtom
  >;
  openSession: ReturnType<typeof useSessionView>["openSession"];
  updateMetadata: ReturnType<typeof useSessionView>["updateMetadata"];
  beginSessionBusy: AtomSetter<typeof beginCloudSessionBusyAtom>;
  updateSessionBusy: AtomSetter<typeof updateCloudSessionBusyAtom>;
  endSessionBusy: AtomSetter<typeof endCloudSessionBusyAtom>;
  upsertDownloadProgress: AtomSetter<
    typeof upsertCloudSessionDownloadProgressAtom
  >;
  clearDownloadProgress: AtomSetter<
    typeof clearCloudSessionDownloadProgressAtom
  >;
}

export function useCloudSessionActionDeps(
  orgId: string | null
): CloudSessionActionDeps {
  const { t } = useTranslation("navigation");
  const store = useStore();
  const [auth, setAuth] = useAtom(org2CloudAuthAtom);
  const { openSession, updateMetadata } = useSessionView();
  const openOrReplaceSessionTab = useSetAtom(
    openOrReplaceSessionInChatPanelTabAtom
  );
  const openCloudBillingPage = useOpenCloudBilling();
  const beginSessionBusy = useSetAtom(beginCloudSessionBusyAtom);
  const updateSessionBusy = useSetAtom(updateCloudSessionBusyAtom);
  const endSessionBusy = useSetAtom(endCloudSessionBusyAtom);
  const upsertDownloadProgress = useSetAtom(
    upsertCloudSessionDownloadProgressAtom
  );
  const clearDownloadProgress = useSetAtom(
    clearCloudSessionDownloadProgressAtom
  );
  // Latest auth via ref so token-refresh writes don't recreate callbacks
  // (same idiom as the panel fetch effects).
  const authRef = useRef(auth);
  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  /** Fresh JWT for a user action (same refresh idiom as the panel). */
  const freshAccessToken = useCallback(async (): Promise<string | null> => {
    const current = authRef.current;
    if (!current) return null;
    const fresh = await ensureFreshSession(current);
    if (!fresh) return null;
    commitRefreshedAuth(setAuth, current, fresh);
    return fresh.accessToken;
  }, [setAuth]);

  const notifyRetentionExpired = useCallback(() => {
    Message.error(t("cloud.orgPanel.retentionUpgrade"), {
      cancel: {
        label: t("cloud.orgPanel.upgrade"),
        onClick: openCloudBillingPage,
      },
    });
  }, [openCloudBillingPage, t]);

  return {
    orgId,
    t,
    store,
    authRef,
    authIdentityKey,
    freshAccessToken,
    notifyRetentionExpired,
    openOrReplaceSessionTab,
    openSession,
    updateMetadata,
    beginSessionBusy,
    updateSessionBusy,
    endSessionBusy,
    upsertDownloadProgress,
    clearDownloadProgress,
  };
}
