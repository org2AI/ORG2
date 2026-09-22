import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SessionCreatorPalette } from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: () => "新建会话" }),
}));

vi.mock("@src/features/SessionCreator/variants", () => ({
  SessionCreatorChatPanel: ({ spotlight }: { spotlight?: boolean }) =>
    createElement("div", {
      "data-testid": "creator",
      "data-spotlight": spotlight,
    }),
}));

vi.mock("../../shell", () => ({
  SpotlightShell: ({ children }: { children: ReactNode }) =>
    createElement("section", { "data-testid": "spotlight-shell" }, children),
}));

describe("SessionCreatorPalette", () => {
  it("renders embedded content without a second modal shell", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCreatorPalette, {
        isOpen: true,
        onClose: vi.fn(),
        asBody: true,
      })
    );

    expect(markup).toContain('data-testid="creator"');
    expect(markup).toContain("新建会话");
    expect(markup).toContain('data-spotlight="true"');
    expect(markup).not.toContain('data-testid="spotlight-shell"');
  });

  it("retains its modal shell when opened standalone", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCreatorPalette, {
        isOpen: true,
        onClose: vi.fn(),
      })
    );

    expect(markup).toContain('data-testid="spotlight-shell"');
    expect(markup).toContain('data-testid="creator"');
  });
});
