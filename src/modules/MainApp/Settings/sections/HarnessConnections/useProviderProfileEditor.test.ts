import { expect, it } from "vitest";

import {
  duplicateProviderProfile,
  newProviderProfile,
} from "./useProviderProfileEditor";

it("copies nested settings without sharing their identity or objects", () => {
  const source = newProviderProfile("claude_code", "Original", null);
  const copy = duplicateProviderProfile(source, "Copy");
  expect(copy.id).not.toBe(source.id);
  expect(copy.revision).toBe(0);
  expect(copy.models).toEqual(source.models);
  if (copy.target !== "codex" && source.target !== "codex") {
    copy.models.roles.opus.model = "changed";
    expect(source.models.roles.opus.model).toBe("");
  }
});

it("bounds localized duplicate names by the native UTF-8 byte limit", () => {
  const source = newProviderProfile("codex", "Original", null);
  const copy = duplicateProviderProfile(source, "副本" + "🦊".repeat(40));
  expect(new TextEncoder().encode(copy.name).length).toBeLessThanOrEqual(120);
  expect(copy.name).not.toContain("\uFFFD");
  expect(
    new TextDecoder("utf-8", { fatal: true }).decode(
      new TextEncoder().encode(copy.name)
    )
  ).toBe(copy.name);
});
