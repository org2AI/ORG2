import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, expect, it, vi } from "vitest";

import {
  ORG2_CLOUD_ENDPOINT_OVERRIDE_STORAGE_KEY,
  buildCloudBillingLoginUrl,
} from "./config";
import { openCloudBilling } from "./useOpenCloudBilling";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@src/components/Message", () => ({ default: { error: vi.fn() } }));
vi.mock("@src/i18n", () => ({ default: { t: (key: string) => key } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.removeItem(ORG2_CLOUD_ENDPOINT_OVERRIDE_STORAGE_KEY);
});
it("opens the shared browser login without a bridge request or desktop token", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await openCloudBilling();
  expect(openUrl).toHaveBeenCalledWith(buildCloudBillingLoginUrl());
  expect(fetch).not.toHaveBeenCalled();
});
it("uses the current custom endpoint", async () => {
  localStorage.setItem(
    ORG2_CLOUD_ENDPOINT_OVERRIDE_STORAGE_KEY,
    JSON.stringify({
      webOrigin: "https://custom.test",
      supabaseUrl: "https://auth.test",
      anonKey: "public",
    })
  );
  await openCloudBilling();
  expect(openUrl).toHaveBeenCalledWith(
    "https://custom.test/login?return_to=%2Fbilling"
  );
});
