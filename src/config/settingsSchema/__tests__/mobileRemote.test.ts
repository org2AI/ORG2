import { describe, expect, it } from "vitest";

import { generateJsoncContent, validateSettings } from "../index";

describe("Retired Mobile Remote settings", () => {
  it("drops the unused desktop token at validation and serialization", () => {
    const settings = validateSettings({
      "mobileRemote.desktopToken": "legacy-shared-secret",
    });

    expect(settings).not.toHaveProperty("mobileRemote.desktopToken");
    expect(generateJsoncContent(settings)).not.toContain(
      '"mobileRemote.desktopToken": "legacy-shared-secret"'
    );
  });
});
