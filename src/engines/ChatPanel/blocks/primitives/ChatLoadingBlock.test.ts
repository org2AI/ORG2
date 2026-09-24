import { createInstance } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import en from "@src/i18n/locales/en/common.json";
import zh from "@src/i18n/locales/zh/common.json";

import ChatLoadingBlock from "./ChatLoadingBlock";

describe("ChatLoadingBlock", () => {
  it.each(["en", "zh"])("announces loading visibly in %s", async (lng) => {
    const i18n = createInstance();
    await i18n.init({
      lng,
      defaultNS: "common",
      resources: { en: { common: en }, zh: { common: zh } },
    });
    const markup = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(ChatLoadingBlock))
    );

    expect(markup).toContain("mx-auto w-full max-w-[800px]");
    expect(markup).toContain('data-testid="chat-loading-block"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain(
      `<span>${lng === "zh" ? zh.status.loading : en.status.loading}</span>`
    );
    expect(markup).toContain("motion-reduce:animate-none");
  });
});
