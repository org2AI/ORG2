import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useTestTranslation } from "@src/test/i18nTestTranslate";

import { AgentOrgFinalizingBanner } from "./ChatStatusBanners";

vi.mock("react-i18next", () => ({
  useTranslation: (...args: Parameters<typeof useTestTranslation>) =>
    useTestTranslation(...args),
}));

describe("AgentOrgFinalizingBanner", () => {
  it("keeps a persistent accessible explanation above the disabled sender", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentOrgFinalizingBanner)
    );

    expect(markup).toContain('data-testid="agent-org-finalizing-banner"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Finishing this work round");
    expect(markup).toContain("Keep editing your draft");
  });
});
