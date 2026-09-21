import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Placeholder } from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("Placeholder typography adaptation", () => {
  it.each(["sidebar", "detail-panel"] as const)(
    "keeps %s Desktop defaults and supports explicit mobile roles",
    (placement) => {
      const defaults = renderToStaticMarkup(
        createElement(Placeholder, {
          variant: "error",
          placement,
          title: "Failed",
          subtitle: "Retry later",
        })
      );
      expect(defaults).toContain(
        placement === "sidebar" ? "text-[11px]" : "text-[14px]"
      );
      const mobile = renderToStaticMarkup(
        createElement(Placeholder, {
          variant: "error",
          placement,
          title: "Failed",
          subtitle: "Retry later",
          titleClassName: "mobile-type-heading",
          subtitleClassName: "mobile-type-secondary",
        })
      );
      expect(mobile).toContain("mobile-type-heading text-danger-6");
      expect(mobile).toContain("mobile-type-secondary text-text-3");
      expect(mobile).not.toMatch(/text-\[\d+px\]/);
      expect(mobile).toContain("Failed");
      expect(mobile).toContain("Retry later");
    }
  );
});
