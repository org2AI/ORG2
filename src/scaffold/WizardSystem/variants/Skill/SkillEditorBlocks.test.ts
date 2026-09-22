// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { BundledFileEntry } from "./SkillEditorBlocks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/features/CodeMirror/Editor", () => ({
  CodeMirrorEditor: () =>
    createElement("textarea", { "data-testid": "editor" }),
}));
vi.mock("@src/hooks/skills/useSkillEditor", () => ({}));
vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));
describe("protected skill attachments", () => {
  it.each([{ readError: "Cannot read file" }, { binary: true }])(
    "keeps a protected attachment visible without an editable content surface: %j",
    async (protection) => {
      const root = createSmokeRoot();
      try {
        await root.render(
          createElement(BundledFileEntry, {
            file: { relativePath: "asset.png", content: "", ...protection },
            onChange: vi.fn(),
            onRemove: vi.fn(),
          })
        );
        expect(root.container.querySelector("input")?.disabled).toBe(true);
        expect(
          root.container.querySelector('[data-testid="editor"]')
        ).toBeNull();
        expect(root.container.textContent).toContain(
          "readError" in protection
            ? protection.readError
            : "common:placeholders.binaryUnsupportedEncoding"
        );
      } finally {
        await root.unmount();
      }
    }
  );
  it("leaves a successfully loaded empty text file editable", async () => {
    const root = createSmokeRoot();
    try {
      await root.render(
        createElement(BundledFileEntry, {
          file: {
            relativePath: "empty.txt",
            content: "",
            originalPath: "empty.txt",
            originalContent: "",
          },
          onChange: vi.fn(),
          onRemove: vi.fn(),
        })
      );
      expect(root.container.querySelector("input")?.disabled).toBe(false);
      expect(
        root.container.querySelector('[data-testid="editor"]')
      ).not.toBeNull();
    } finally {
      await root.unmount();
    }
  });
});
