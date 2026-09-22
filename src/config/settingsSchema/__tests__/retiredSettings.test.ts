import { describe, expect, it } from "vitest";

import { generateSettingsJsonSchema } from "../generateJsonSchema";
import {
  generateJsoncContent,
  getSettingsDefaults,
  validateSettings,
} from "../index";

const retiredSettings = {
  "general.setupWalkthroughProgress": {
    version: 1,
    dismissed: true,
    guideCompletedMilestones: [],
  },
  "general.githubStarPromptCompleted": true,
  "general.githubStarPromptDisabled": true,
  "general.githubStarPromptDeferredUntil": 123,
  "general.githubStarPromptLastShownAt": 456,
  "general.githubStarPromptNextEligibleValueCount": 2,
  "mobileRemote.desktopToken": "retired-test-token",
};

describe("retired settings removal", () => {
  it("cannot reintroduce retired keys through defaults, validation, JSONC or JSON Schema", () => {
    const defaults = getSettingsDefaults();
    const settings = validateSettings({
      ...retiredSettings,
      "general.language": "zh",
    });
    const jsonc = generateJsoncContent(settings);
    const schema = JSON.parse(generateSettingsJsonSchema());
    expect(settings["general.language"]).toBe("zh");
    for (const key of Object.keys(retiredSettings)) {
      expect(Object.keys(defaults)).not.toContain(key);
      expect(Object.keys(settings)).not.toContain(key);
      expect(Object.keys(schema.properties)).not.toContain(key);
      expect(jsonc).not.toContain(JSON.stringify(key));
    }
  });

  it("preserves live configuration even when it has no settings-page control", () => {
    const input = {
      "privacy.offlineMode": true,
      "general.userDisplayName": "Test creator",
      "terminal.letterSpacing": 1,
      "mobileRemote.desktopId": "test-desktop",
      "mobileRemote.lanPort": 14000,
    };
    const settings = validateSettings(input);
    expect(settings).toMatchObject(input);
    for (const key of Object.keys(input)) {
      expect(generateJsoncContent(settings)).toContain(JSON.stringify(key));
    }
  });
});
