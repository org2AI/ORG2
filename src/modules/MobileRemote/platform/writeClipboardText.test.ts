// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "./writeClipboardText";

afterEach(() => vi.restoreAllMocks());

describe("mobile shell clipboard adapter", () => {
  it("writes through the Web Clipboard API without reading it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await writeClipboardText("exact code\n");
    expect(writeText).toHaveBeenCalledWith("exact code\n");
  });

  it("propagates permission failure instead of claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(writeClipboardText("code")).rejects.toThrow("denied");
  });

  it("cleans the legacy fallback and restores focus on failure", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    await expect(writeClipboardText("code")).rejects.toThrow(
      "Clipboard write failed"
    );
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});
