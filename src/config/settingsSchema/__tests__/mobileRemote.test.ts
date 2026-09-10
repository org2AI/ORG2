import { describe, expect, it } from "vitest";

import { generateJsoncContent, validateSettings } from "../index";

describe("Mobile Remote settings compatibility", () => {
  it("round-trips the deprecated desktop token without using it as active auth", () => {
    const settings = validateSettings({
      "mobileRemote.desktopToken": "legacy-shared-secret",
    });

    expect(settings["mobileRemote.desktopToken"]).toBe("legacy-shared-secret");
    expect(generateJsoncContent(settings)).toContain(
      '"mobileRemote.desktopToken": "legacy-shared-secret"'
    );
  });
});
