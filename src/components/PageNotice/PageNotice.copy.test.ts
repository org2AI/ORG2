// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import Message from "@src/components/Message";
import { copyText } from "@src/util/data/clipboard";

import PageNotice from ".";

vi.mock("@src/util/data/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("@src/components/Message", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.resetAllMocks();
});

describe("PageNotice copy", () => {
  it("can omit copying transient guidance while keeping the primary recovery action", async () => {
    const retry = vi.fn();
    root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          PageNotice,
          {
            title: "Connection unavailable",
            copyable: false,
            action: { label: "Reconnect", onClick: retry },
          },
          "Check that your computer is running"
        )
      )
    );
    expect(container.querySelector('[aria-label="actions.copy"]')).toBeNull();
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("Reconnect");
    await act(async () => button.click());
    expect(retry).toHaveBeenCalledOnce();
    expect(copyText).not.toHaveBeenCalled();
  });

  it("copies title, nested details and subtitle without triggering Retry", async () => {
    vi.mocked(copyText).mockResolvedValue(undefined);
    const retry = vi.fn();
    root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          PageNotice,
          {
            title: "Send failed",
            titleSuffix: "(retry 2 of 3)",
            subtitle: "Try again later",
            action: { label: "Retry", onClick: retry },
          },
          createElement("pre", null, "First line\nSecond line")
        )
      )
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons[0].getAttribute("aria-label")).toBe("actions.copy");
    expect(buttons[1].textContent).toBe("Retry");
    await act(async () => buttons[0].click());
    expect(copyText).toHaveBeenCalledWith(
      "Send failed (retry 2 of 3)\n\nFirst line\nSecond line\n\nTry again later"
    );
    expect(retry).not.toHaveBeenCalled();
    expect(Message.success).toHaveBeenCalledWith("status.copied");
  });

  it("copies titleless notices and reports clipboard failures", async () => {
    vi.mocked(copyText).mockRejectedValue(new Error("Clipboard unavailable"));
    root = createRoot(container);
    await act(async () =>
      root.render(createElement(PageNotice, null, "Details"))
    );
    await act(async () => container.querySelector("button")!.click());
    expect(copyText).toHaveBeenCalledWith("Details");
    expect(Message.error).toHaveBeenCalledWith("status.copyFailed");
    expect(Message.success).not.toHaveBeenCalled();
  });
});
