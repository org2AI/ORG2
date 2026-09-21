// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobileConnectionState } from "../connection/types";
import { MobileConnectionNotice } from "./MobileConnectionNotice";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("MobileConnectionNotice", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const reconnecting: MobileConnectionState = {
    status: "connecting",
    presence: "offline",
    demoMode: false,
  };
  const failed = {
    ...reconnecting,
    error: {
      code: -1,
      message: "private server detail",
      connectionIssue: "ticket" as const,
    },
  };
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = async (
    connection: MobileConnectionState,
    onRetry?: () => Promise<boolean>
  ) => {
    await act(async () =>
      root.render(
        React.createElement(MobileConnectionNotice, { connection, onRetry })
      )
    );
  };
  const retryButton = () =>
    Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "connectionRecovery.retry"
    )!;
  it("explains failure without raw errors, retains it through retries, and disappears on recovery", async () => {
    await render(reconnecting);
    expect(host.textContent).toBe("connection.reconnecting");
    await render(failed, vi.fn().mockResolvedValue(true));
    expect(host.textContent).toContain("connectionFeedback.ticket");
    expect(host.textContent).toContain("connectionFeedback.retrying");
    expect(host.textContent).not.toContain("private server detail");
    expect(retryButton()?.textContent).toBe("connectionRecovery.retry");
    await render({ ...failed });
    expect(host.textContent).toContain("connectionFeedback.ticket");
    await render({ ...reconnecting, status: "connected", presence: "online" });
    expect(host.innerHTML).toBe("");
  });
  it.each(["ticket", "authorization", undefined] as const)(
    "uses typed recovery guidance for %s",
    async (connectionIssue) => {
      await render({
        ...failed,
        status: "error",
        error: { ...failed.error, connectionIssue },
      });
      expect(host.textContent).toContain(
        `connectionFeedback.${connectionIssue ?? "unavailable"}`
      );
      expect(host.textContent).not.toContain("connectionFeedback.retrying");
    }
  );
  it("coalesces user retries, disables the action, and exposes unsuccessful recovery", async () => {
    let finish!: (value: boolean) => void;
    const onRetry = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    await render(failed, onRetry);
    const button = retryButton();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    await act(async () => {
      finish(false);
    });
    expect(retryButton().disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "connectionRecovery.retryFailed"
    );
    onRetry.mockRejectedValueOnce(new Error("private failure"));
    await act(async () => retryButton().click());
    expect(host.textContent).not.toContain("private failure");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});
