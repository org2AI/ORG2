import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { sourceLabel, sourceLocation } from "./presentation";

const t = ((key: string) => key) as TFunction;
function image(originalRef: string): Extract<SessionSource, { kind: "image" }> {
  return {
    kind: "image",
    key: "opaque-image-key",
    ref: `orgii-transcript-image:${JSON.stringify(["private-session-id", "private-turn-id", originalRef])}`,
    fileName: "design.png",
    origin: "attachment",
  };
}

describe("source display projection", () => {
  it("decodes a readable image location without changing the navigation identity", () => {
    const source = image("/project/design.png");
    const original = source.ref;
    expect(sourceLocation(source)).toBe("/project/design.png");
    expect(sourceLabel(t, source)).toBe("design.png");
    expect(source.ref).toBe(original);
  });

  it.each([
    "codex-inline-image:0",
    "claude-inline-image:2",
    "data:image/png;base64,secret",
    "blob:browser-owned",
  ])("does not expose opaque image location %s", (reference) => {
    expect(sourceLocation(image(reference))).toBeNull();
  });

  it("handles malformed transcript identities without leaking their payload", () => {
    const source: SessionSource = {
      kind: "image",
      key: "malformed",
      ref: 'orgii-transcript-image:["private-session-id"]',
      fileName: 'orgii-transcript-image:["private-session-id"]',
    };
    expect(sourceLocation(source)).toBeNull();
    expect(sourceLabel(t, source)).toBe("common:git.rail.sourceImage");
  });
});
