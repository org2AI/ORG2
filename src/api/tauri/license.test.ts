import { describe, expect, it, vi } from "vitest";

import { readAppLicense } from "./license";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("readAppLicense", () => {
  it("requests the license from the desktop runtime", async () => {
    invoke.mockResolvedValue("GNU AFFERO GENERAL PUBLIC LICENSE");

    await expect(readAppLicense()).resolves.toContain(
      "GNU AFFERO GENERAL PUBLIC LICENSE"
    );
    expect(invoke).toHaveBeenCalledWith("app_license_read");
  });
});
