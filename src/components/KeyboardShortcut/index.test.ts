import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

function setUserAgent(userAgent: string) {
  vi.stubGlobal("navigator", { userAgent });
}

describe("KeyboardShortcut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders Ctrl as text on Linux", async () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    const { KeyboardShortcut } = await import("./index");

    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, { shortcut: "Ctrl+Enter" })
    );

    expect(markup).toContain("Ctrl");
  });

  it("renders every key in a chord inside one rounded pill", async () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const { KeyboardShortcut } = await import("./index");

    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, {
        shortcut: "Cmd+Shift+Option+Ctrl+Up+Down+Enter+Backspace+Esc+Tab+2",
        className: "external-spacing",
      })
    );

    expect(markup.match(/<kbd/g)).toHaveLength(1);
    expect(markup).toContain(
      '<div class="flex items-center external-spacing"><kbd'
    );
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("font-normal");
    expect(markup).not.toContain("font-semibold");
    for (const character of [
      "⌘",
      "⇧",
      "⌥",
      "⌃",
      "↑",
      "↓",
      "↩",
      "⌫",
      "esc",
      "⇥",
    ]) {
      expect(markup).toContain(character);
    }
    expect(markup).toContain("↑");
    expect(markup).toContain("↓");
    expect(markup).not.toContain("<svg");
    expect(markup).toContain("font-family:system-ui");
    expect(markup).not.toContain("text-[11px]");
    expect(markup).not.toContain("↵");
    expect(markup).toContain(">2</span>");
  });

  it.each(["spotlightFooter", "default"] as const)(
    "preserves original rendering for Spotlight %s shortcuts",
    async (variant) => {
      const { KeyboardShortcut } = await import("./index");
      const markup = renderToStaticMarkup(
        createElement(KeyboardShortcut, {
          shortcut: "Up+Down+Enter+Esc",
          variant,
          ...(variant === "default" ? { rendering: "original" as const } : {}),
        })
      );
      expect(markup).toContain('data-icon="arrow-up"');
      expect(markup).toContain('data-icon="arrow-down"');
      expect(markup).toContain('data-icon="corner-down-left"');
      expect(markup).toContain("text-[11px]");
      expect(markup).not.toContain("font-family:system-ui");
    }
  );

  it("sets the native font on Shift itself despite the global span reset", async () => {
    const { KeyboardShortcut } = await import("./index");
    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, { shortcut: "Shift+M" })
    );
    expect(markup).toMatch(/<span style="font-family:system-ui[^>]+>⇧<\/span>/);
  });

  it("gives single-character keys an icon-sized slot", async () => {
    const { KeyboardShortcut } = await import("./index");
    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, { shortcut: "Option+Cmd+G" })
    );

    expect(markup).toContain("w-[13px]");
    expect(markup).toMatch(/class="[^"]*w-\[13px\][^"]*">G<\/span>/);
  });

  it("lets multi-character keys keep their natural width", async () => {
    const { KeyboardShortcut } = await import("./index");
    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, { shortcut: "Ctrl+F6" })
    );

    expect(markup).toMatch(/class="(?![^"]*w-\[13px\])[^"]*">F6<\/span>/);
  });

  it("keeps standalone and packed function keys as one token", async () => {
    const { KeyboardShortcut } = await import("./index");
    const standaloneMarkup = renderToStaticMarkup(
      createElement(KeyboardShortcut, { shortcut: "F6" })
    );
    const packedMarkup = renderToStaticMarkup(
      createElement(KeyboardShortcut, { shortcut: "⇧⌘F12" })
    );

    expect(standaloneMarkup).toContain(">F6</span>");
    expect(packedMarkup).toContain(">F12</span>");
    expect(packedMarkup).not.toContain(">F</span>");
  });

  it("supports the icon-backed settings presentation", async () => {
    const { KeyboardShortcut } = await import("./index");
    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, {
        shortcut: "Option+Cmd+G",
        variant: "prominent",
      })
    );

    expect(markup).toContain("h-6");
    expect(markup).toContain('data-icon="option"');
    expect(markup).toContain('data-icon="command"');
    expect(markup).toMatch(/class="[^"]*w-3\.5[^"]*">G<\/span>/);
    expect(markup).toContain("text-[11px]");
  });

  it("uses the reduced text size at every presentation level", async () => {
    const { KeyboardShortcut } = await import("./index");
    const cases = [
      [{ shortcut: "G" }, "text-[12px]"],
      [{ shortcut: "G", size: "sm" as const }, "text-[10px]"],
      [{ shortcut: "G", variant: "prominent" as const }, "text-[11px]"],
      [{ shortcut: "G", variant: "inline" as const }, "text-[11px]"],
    ] as const;

    for (const [props, textClass] of cases) {
      const markup = renderToStaticMarkup(
        createElement(KeyboardShortcut, props)
      );
      expect(markup).toContain(textClass);
    }
  });

  it("uses slightly more left padding on every pill size", async () => {
    const { KeyboardShortcut } = await import("./index");
    const cases = [
      [{ shortcut: "G" }, ["pr-1.5", "pl-2"]],
      [{ shortcut: "G", size: "sm" as const }, ["pr-1", "pl-1.5"]],
      [{ shortcut: "G", variant: "prominent" as const }, ["pr-2", "pl-2.5"]],
    ] as const;

    for (const [props, paddingClasses] of cases) {
      const markup = renderToStaticMarkup(
        createElement(KeyboardShortcut, props)
      );
      for (const paddingClass of paddingClasses) {
        expect(markup).toContain(paddingClass);
      }
    }

    const inlineMarkup = renderToStaticMarkup(
      createElement(KeyboardShortcut, {
        shortcut: "G",
        variant: "inline",
      })
    );
    expect(inlineMarkup).not.toMatch(/\b(?:pl|pr)-/);
  });

  it("renders alternate chords as separate shared pills", async () => {
    const { KeyboardShortcut } = await import("./index");
    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, {
        shortcut: "Ctrl+Tab / ⌘⌥→",
        rendering: "icons",
      })
    );

    expect(markup.match(/<kbd/g)).toHaveLength(2);
    expect(markup).toContain('data-icon="arrow-right"');
    expect(markup).toContain(">/</span>");
  });

  it("keeps the icon-backed special keys formerly used by settings", async () => {
    const { KeyboardShortcut } = await import("./index");
    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, {
        shortcut: "Cmd+Backspace+Space+Left+Right",
        rendering: "icons",
      })
    );

    for (const dataIcon of [
      "command",
      "delete",
      "space",
      "arrow-left",
      "arrow-right",
    ]) {
      expect(markup).toContain(`data-icon="${dataIcon}"`);
    }
  });

  it("does not render an empty shortcut pill", async () => {
    const { KeyboardShortcut } = await import("./index");
    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, { shortcut: "" })
    );

    expect(markup).toBe("");
  });

  it("supports a compact size for dense menus", async () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const { KeyboardShortcut } = await import("./index");

    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, {
        shortcut: "Cmd+Shift+G",
        size: "sm",
      })
    );

    expect(markup).toContain("h-4");
    expect(markup).toContain(
      "inline-flex h-full items-center justify-center align-middle"
    );
    expect(markup).toContain("text-[10px]");
    expect(markup).toContain("w-[11px]");
    expect(markup).toContain("⌘");
    expect(markup).toContain("⇧");
    expect(markup).not.toContain("data-icon=");
  });

  it("keeps the up and down text symbols close together", async () => {
    const { KeyboardShortcut } = await import("./index");

    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcut, { shortcut: "↑ ↓" })
    );

    expect(markup).toContain("gap-0");
    expect(markup).toContain("↑");
    expect(markup).toContain("↓");
  });
});

describe("KeyboardShortcutTooltipContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("lets long labels wrap while shortcut keys stay in the shared row", async () => {
    const { KeyboardShortcutTooltipContent } = await import("./index");
    const markup = renderToStaticMarkup(
      createElement(KeyboardShortcutTooltipContent, {
        label:
          "A translated tooltip label that can become wider than the viewport",
        shortcut: "Cmd+Enter",
      })
    );

    expect(markup).toContain("max-w-full min-w-0");
    expect(markup).toContain("min-w-0 wrap-break-word");
    expect(markup).not.toContain("whitespace-nowrap");
  });
});
