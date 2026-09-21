import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MobileShell } from "./MobileShell";

describe("MobileShell", () => {
  it("owns the viewport so long transcripts scroll without displacing the composer", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        MobileShell,
        null,
        React.createElement("div", null, "chat")
      )
    );

    expect(markup).toContain("h-full justify-center overflow-hidden");
    expect(markup).toContain("pt-[env(safe-area-inset-top)]");
    expect(markup).toContain("pr-[env(safe-area-inset-right)]");
    expect(markup).toContain("pl-[env(safe-area-inset-left)]");
    expect(markup).toContain("h-full min-h-0");
  });

  it("keeps the fluid shell width with a reading cap, not a phone-model width", () => {
    const markup = renderToStaticMarkup(React.createElement(MobileShell));
    expect(markup).toContain("w-full");
    const styles = readFileSync(
      new URL("../mobileChrome.scss", import.meta.url),
      "utf8"
    );
    const viewport = styles.match(
      /\.mobile-shell__viewport\s*\{([^}]+)\}/
    )?.[1];
    expect(viewport).toContain("min-width: 0");
    expect(viewport).toContain("max-width: 48rem");
    expect(viewport).not.toContain("393px");
  });

  it("uses the chat canvas for the shell and detail header in every theme", () => {
    const styles = readFileSync(
      new URL("../mobileChrome.scss", import.meta.url),
      "utf8"
    );

    expect(styles).toContain("--mobile-canvas: var(--color-chat-container);");
    expect(styles).not.toContain("--mobile-canvas: #101010");
    expect(styles).not.toContain("--mobile-canvas: #f8f8f8");
    expect(styles).toMatch(
      /\.mobile-shell__viewport\s*\{[^}]*background:\s*var\(--mobile-canvas\)/s
    );
  });

  it("derives mobile chrome colors and elevation from shared theme tokens", () => {
    const styles = readFileSync(
      new URL("../mobileChrome.scss", import.meta.url),
      "utf8"
    );

    expect(styles).toContain("--mobile-accent: var(--color-text-1);");
    expect(styles).toContain("--mobile-glass-solid: var(--color-bg-2);");
    expect(styles).toContain("--mobile-selected: var(--color-fill-2);");
    expect(styles).toContain(
      "--mobile-glass-shadow: var(--shadow-dropdown-soft);"
    );
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(styles).not.toMatch(/\brgba?\s*\(/i);
  });
});
