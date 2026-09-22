// @vitest-environment jsdom
import { createInstance } from "i18next";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadPrismHtml } from "@src/hooks/code/prismHtmlLoader";
import common from "@src/i18n/locales/en/common.json";

import {
  MobileRemotePlatformProvider,
  type MobileRemotePlatformProviderProps,
} from "../../platform/MobileRemotePlatformContext";
import type { MobileRemotePlatform } from "../../platform/types";
import { AgentBubble } from "./AgentBubble";

const i18n = createInstance();
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
await i18n.init({
  lng: "en",
  resources: { en: { common } },
  initImmediate: false,
});

let root: Root;
let host: HTMLDivElement;
let platform: MobileRemotePlatform;
const write = vi.fn<(text: string) => Promise<void>>();

async function render(text: string, streaming = false) {
  await act(async () =>
    root.render(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(
          MobileRemotePlatformProvider,
          { platform } as MobileRemotePlatformProviderProps,
          React.createElement(AgentBubble, { text, streaming })
        )
      )
    )
  );
}
async function clickCopy() {
  await act(async () =>
    (host.querySelector("button") as HTMLButtonElement).click()
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  write.mockReset().mockResolvedValue(undefined);
  platform = {
    writeClipboardText: write,
    runtime: {
      setTimeout: (callback: () => void, delay: number) =>
        window.setTimeout(callback, delay),
      clearTimeout: (id: number) => window.clearTimeout(id),
    },
  } as unknown as MobileRemotePlatform;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("portable Markdown fenced-code interaction", () => {
  it("keeps inline code inline and copies the exact fenced source using shared toolbar", async () => {
    await render(
      "Inline `answer`\n\n```typescript\nconst answer = '<safe>';\n```\n"
    );
    expect(host.querySelector("p code")?.textContent).toBe("answer");
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(
      host.querySelector(".code-block-toolbar[data-touch]")
    ).not.toBeNull();
    expect(host.querySelector("pre code")?.textContent).toBe(
      "const answer = '<safe>';"
    );
    await clickCopy();
    expect(write).toHaveBeenCalledWith("const answer = '<safe>';");
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Copied"
    );
    await act(async () => {
      await loadPrismHtml();
    });
    expect(host.querySelector("pre .token.keyword")).not.toBeNull();
  });

  it("shows failure, preserves source and allows a successful retry", async () => {
    write.mockRejectedValueOnce(new Error("denied"));
    await render("```\nhello\n```");
    await clickCopy();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Copy failed"
    );
    expect(host.querySelector("pre code")?.textContent).toBe("hello");
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Copy"
    );
    await clickCopy();
    expect(write).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Copied"
    );
  });

  it("locks duplicate writes and ignores late results after source changes", async () => {
    let finish!: () => void;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render("```\nold\n```");
    await clickCopy();
    expect((host.querySelector("button") as HTMLButtonElement).disabled).toBe(
      true
    );
    await clickCopy();
    expect(write).toHaveBeenCalledTimes(1);
    await render("```\nnew\n```");
    await render("```\nold\n```");
    expect((host.querySelector("button") as HTMLButtonElement).disabled).toBe(
      false
    );
    await render("```\nnew\n```");
    await act(async () => finish());
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Copy"
    );
    await clickCopy();
    expect(write).toHaveBeenLastCalledWith("new");
  });

  it("bounds a stalled clipboard operation and cleans timeout on unmount", async () => {
    vi.useFakeTimers();
    write.mockImplementation(() => new Promise<void>(() => undefined));
    await render("```\nhello\n```", true);
    await clickCopy();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Copy failed"
    );
    await clickCopy();
    await render("No code remains");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retain a pending copy when the shell changes", async () => {
    let finish!: () => void;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render("```\nhello\n```");
    await clickCopy();
    platform = { ...platform };
    await render("```\nhello\n```");
    await act(async () => finish());
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Copy"
    );
    expect((host.querySelector("button") as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("keeps streaming and oversized fences readable without eager tokenization", async () => {
    await render("```typescript\nconst stream = true;\n```", true);
    expect(host.querySelector("pre .token")).toBeNull();
    await render("```typescript\nconst stream = true;\n```", false);
    await act(async () => {
      await loadPrismHtml();
    });
    expect(host.querySelector("pre .token.keyword")).not.toBeNull();
    await render(
      `\`\`\`typescript\n${"const large = 1;\n".repeat(2_000)}\`\`\``
    );
    expect(host.querySelector("pre .token")).toBeNull();
    expect(host.querySelector("pre code")?.textContent?.length).toBeGreaterThan(
      20_000
    );
  });
});
