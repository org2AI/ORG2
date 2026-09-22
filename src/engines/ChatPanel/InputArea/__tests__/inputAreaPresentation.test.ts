import { describe, expect, it } from "vitest";

import {
  isContextualInputAreaPresentation,
  shouldUseCompactComposerLayout,
} from "../inputAreaPresentation";

function compactLayout(
  overrides: Partial<Parameters<typeof shouldUseCompactComposerLayout>[0]> = {}
): boolean {
  return shouldUseCompactComposerLayout({
    compactInputEnabled: true,
    chatPanelFullScreen: true,
    isEditMode: false,
    hasImages: false,
    isCiteCode: false,
    isReply: false,
    editorMultiline: false,
    ...overrides,
  });
}

describe("isContextualInputAreaPresentation", () => {
  it("only classifies contextual composers as contextual", () => {
    expect(isContextualInputAreaPresentation("default")).toBe(false);
    expect(isContextualInputAreaPresentation("contextual")).toBe(true);
  });
});

describe("shouldUseCompactComposerLayout", () => {
  it("keeps the full-size composer while the preference is off", () => {
    expect(compactLayout({ compactInputEnabled: false })).toBe(false);
  });

  it("uses the shared compact row in the full-screen chat panel once the preference is on", () => {
    expect(compactLayout()).toBe(true);
  });

  it("keeps the full-size composer outside the full-screen chat panel", () => {
    expect(compactLayout({ chatPanelFullScreen: false })).toBe(false);
  });

  it("expands the compact row when the editor becomes multiline", () => {
    expect(compactLayout({ editorMultiline: true })).toBe(false);
  });

  it.each([
    ["edit mode", { isEditMode: true }],
    ["image attachment", { hasImages: true }],
    ["code citation", { isCiteCode: true }],
    ["reply context", { isReply: true }],
  ])("does not compact around %s", (_label, blockedState) => {
    expect(compactLayout(blockedState)).toBe(false);
  });
});
