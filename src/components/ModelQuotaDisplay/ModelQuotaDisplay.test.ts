import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { QuotaSnapshot } from "@src/api/types/keyVault";

import ModelQuotaDisplay from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function render(percent?: number) {
  const quotaInfo: QuotaSnapshot = {
    remaining_percentage: 0,
    model_quotas:
      percent === undefined
        ? undefined
        : [
            {
              model: "gpt-5.6-luna",
              limit_id: "gpt-reserve",
              allowed: percent > 0,
              limit_reached: percent === 0,
              usage_items: [
                {
                  usage_type: "weekly",
                  enabled: true,
                  used: null,
                  limit: null,
                  remaining: null,
                  remaining_percentage: percent,
                  reset_time: "2026-10-01T00:00:00Z",
                },
              ],
            },
          ],
  };
  return renderToStaticMarkup(createElement(ModelQuotaDisplay, { quotaInfo }));
}

describe("model-scoped quota display", () => {
  it("renders reported reserve separately with its own reset time", () => {
    const markup = render(96);
    expect(markup).toContain("GPT 5.6 Luna Reserve");
    expect(markup).toContain("96% left");
    expect(markup).toContain(
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date("2026-10-01T00:00:00Z"))
    );
  });
  it("keeps exhausted reserve visible without inventing missing capacity", () => {
    expect(render(0)).toContain("0% left");
    expect(render()).toBe("");
  });
});
