// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ComposerInput, {
  type ComposerInputRef,
} from "@src/components/ComposerInput";
import { ICON_MAP } from "@src/components/FileTypeIcon/config";
import { readPillText } from "@src/config/pillTokens";
import {
  type AddToAgentRequest,
  addToAgentAtom,
} from "@src/store/ui/addToAgentAtom";
import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useAddToAgentInsertion } from "./useAddToAgentInsertion";

vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));
vi.mock("@src/store/skills/installedSkillsAtom", async () => {
  const { atom } = await import("jotai");
  return { installedSkillsAtom: atom([]) };
});

describe("useAddToAgentInsertion", () => {
  let root: SmokeRoot;
  beforeEach(() => {
    vi.useFakeTimers();
    root = createSmokeRoot();
  });
  afterEach(async () => {
    await root.unmount();
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  it.each(["", "Existing prompt "])(
    "inserts a file selection into %j with its file icon and caret after the pill",
    async (initialContent) => {
      const store = createStore();
      const ref = createRef<ComposerInputRef>();
      function Harness() {
        useAddToAgentInsertion(ref);
        return createElement(ComposerInput, { ref, initialContent });
      }
      await root.render(
        createElement(Provider, { store }, createElement(Harness))
      );
      const text = "# Selected old revision\nremoved content";
      act(() =>
        store.set(addToAgentAtom, {
          type: "file-selection",
          filePath: "docs/README.md",
          fileName: "README.md",
          text,
        })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const pill = root.container.querySelector<HTMLElement>(
        "[data-composer-pill]"
      )!;
      expect(pill.getAttribute("data-icon-type")).toBe("paste");
      expect(pill.querySelector('[data-icon="terminal"]')).toBeNull();
      expect(pill.textContent).toContain("README.md");
      expect(pill.querySelector("img")?.getAttribute("src")).toBe(
        ICON_MAP.readme
      );
      expect(readPillText(pill.getAttribute("data-file-path")!)).toBe(text);
      expect(ref.current?.getTextWithPills()).toContain(
        btoa(encodeURIComponent(text))
      );
      expect(ref.current?.getText()).toBe(`${initialContent}README.md `);
      expect(store.get(addToAgentAtom)).toBeNull();
      const selection = window.getSelection()!;
      expect(selection.anchorNode).toBe(pill.nextSibling);
      expect(selection.anchorOffset).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(selection.anchorNode).toBe(pill.nextSibling);
      expect(selection.anchorOffset).toBe(1);
    }
  );

  it("cancels insertion when the consumer unmounts before its editor is ready", async () => {
    const store = createStore();
    const ref = createRef<ComposerInputRef>();
    const request: AddToAgentRequest = {
      type: "file",
      filePath: "a.ts",
      fileName: "a.ts",
    };
    function Harness() {
      useAddToAgentInsertion(ref);
      return null;
    }
    store.set(addToAgentAtom, request);
    await root.render(
      createElement(Provider, { store }, createElement(Harness))
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await root.render(createElement("div"));
    expect(vi.getTimerCount()).toBe(0);
    expect(store.get(addToAgentAtom)).toBe(request);
  });
});
