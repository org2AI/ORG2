/** Website shortcut opens one explicit native consent; it cannot authorize supply. */
import { atom } from "jotai";

import Message from "@src/components/Message";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { openOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";
import i18n from "@src/i18n";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { type MarketStore, captureMarketOwner } from "./identity";
import { connectSellerAccount } from "./sellerAuthorization";
import { isMarketAppUrl } from "./urlPolicy";

type Selection = { provider: "claude" | "codex"; region: string };
export type SellerPrompt = Selection & {
  identityUserId: string;
  accountLabel: string;
  phase: "confirm" | "connecting" | "connected" | "failed";
};
export const sellerPromptAtom = atom<SellerPrompt | null>(null);
const attempts = new WeakMap<
  MarketStore,
  {
    controller: AbortController;
    owner: ReturnType<typeof captureMarketOwner>;
  }
>();
export function parseSellerShortcut(raw: string): Selection | null {
  try {
    const url = new URL(raw),
      pairs = [...url.searchParams];
    const provider = url.searchParams.get("provider"),
      region = url.searchParams.get("region");
    if (
      raw.length > 2048 ||
      !isMarketAppUrl(url) ||
      url.pathname !== "/seller/connect" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      pairs.length !== 2 ||
      (provider !== "claude" && provider !== "codex") ||
      !region ||
      !/^[a-z0-9][a-z0-9-]{0,31}$/.test(region)
    )
      return null;
    return { provider, region };
  } catch {
    return null;
  }
}
export function cancelSellerShortcut(
  store: MarketStore = getInstrumentedStore()
) {
  const attempt = attempts.get(store);
  attempts.delete(store);
  attempt?.controller.abort();
  attempt?.owner.dispose();
  store.set(sellerPromptAtom, null);
}
export async function requestSellerShortcut(
  raw: string,
  store: MarketStore = getInstrumentedStore()
) {
  const selection = parseSellerShortcut(raw);
  if (!selection || store.get(sellerPromptAtom)) return;
  const auth = store.get(org2CloudAuthAtom);
  if (!auth) {
    await openOrg2CloudSignIn({
      onSignedIn: () => {
        void requestSellerShortcut(raw, store).catch(() =>
          Message.error(i18n.t("integrations:marketConnection.failed"))
        );
      },
    });
    return;
  }
  const owner = captureMarketOwner(auth.userId, store, () =>
    cancelSellerShortcut(store)
  );
  attempts.set(store, { owner, controller: new AbortController() });
  store.set(sellerPromptAtom, {
    ...selection,
    identityUserId: auth.userId,
    accountLabel:
      auth.profile?.primaryEmail?.trim() ||
      auth.profile?.displayName?.trim() ||
      auth.userId,
    phase: "confirm",
  });
}
export async function confirmSellerShortcut(
  store: MarketStore = getInstrumentedStore()
) {
  const prompt = store.get(sellerPromptAtom),
    attempt = attempts.get(store);
  if (!prompt || prompt.phase !== "confirm" || !attempt) return;
  try {
    attempt.owner.assertCurrent();
    store.set(sellerPromptAtom, { ...prompt, phase: "connecting" });
    await connectSellerAccount(
      prompt.provider,
      attempt.controller.signal,
      store,
      prompt.region
    );
    attempt.owner.assertCurrent();
    if (attempts.get(store) === attempt)
      store.set(sellerPromptAtom, { ...prompt, phase: "connected" });
  } catch {
    if (attempts.get(store) === attempt && !attempt.controller.signal.aborted)
      store.set(sellerPromptAtom, { ...prompt, phase: "failed" });
  }
}
