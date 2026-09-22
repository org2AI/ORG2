// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import ComposerInput, { type ComposerInputRef } from "../index";
import { placeCaretAtEnd } from "../selection";

vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));

// Asset imports are not transformed into components under test.
vi.mock("@src/assets/modelIcons/github-pill.svg", () => ({
  default: () => null,
}));

vi.mock("@src/store/skills/installedSkillsAtom", async () => {
  const { atom } = await import("jotai");
  return { installedSkillsAtom: atom([]) };
});

describe("ComposerInput links a URL as it is typed", () => {
  let root: SmokeRoot;
  let ref: ReturnType<typeof createRef<ComposerInputRef>>;
  let host: HTMLDivElement;
  const onChange = vi.fn();

  beforeEach(() => {
    root = createSmokeRoot();
    ref = createRef<ComposerInputRef>();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await root.unmount();
    window.getSelection()?.removeAllRanges();
  });

  async function mount(text: string): Promise<void> {
    await root.render(
      createElement(ComposerInput, {
        ref,
        initialContent: text,
        onContentChange: onChange,
      })
    );
    host = root.container.querySelector('[contenteditable="true"]')!;
    placeCaretAtEnd(host);
    onChange.mockClear();
  }

  /** What the browser would do for a typed separator, if we let it. */
  function typeSeparator(data: string): InputEvent {
    const event = new InputEvent("beforeinput", {
      inputType: "insertText",
      data,
      bubbles: true,
      cancelable: true,
    });
    act(() => host.dispatchEvent(event));
    return event;
  }

  const pills = () =>
    [...host.querySelectorAll<HTMLElement>("[data-composer-pill]")].map(
      (pill) => pill.getAttribute("data-file-path")
    );

  it("turns an address into a link pill when a space follows it", async () => {
    await mount("see https://example.com/docs");

    const event = typeSeparator(" ");

    expect(event.defaultPrevented).toBe(true);
    expect(pills()).toEqual(["https://example.com/docs"]);
    expect(ref.current?.getText()).toContain("see ");
    expect(onChange).toHaveBeenCalled();
  });

  it("keeps the address exactly as typed, scheme included", async () => {
    await mount("https://github.com");

    typeSeparator(" ");

    const pill = host.querySelector<HTMLElement>("[data-composer-pill]");
    expect(pill?.getAttribute("data-file-name")).toBe("https://github.com");
  });

  it("links a GitHub pull request as its reference pill", async () => {
    await mount("fix https://github.com/org2AI/ORG2/pull/1846");

    typeSeparator(" ");

    expect(pills()).toEqual(["https://github.com/org2AI/ORG2/pull/1846"]);
  });

  it("leaves ordinary words and a bare scheme alone", async () => {
    for (const text of ["just words", "https://", "(https://x.dev)"]) {
      await mount(text);
      const event = typeSeparator(" ");
      expect(event.defaultPrevented).toBe(false);
      expect(pills()).toEqual([]);
    }
  });
});
