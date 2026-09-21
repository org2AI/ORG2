// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PermissionSheet } from "./PermissionSheet";

vi.mock("@src/components/BottomSheet", () => ({
  default: ({
    children,
    footer,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
  }) => React.createElement("section", null, children, footer),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("PermissionSheet request fidelity", () => {
  it("shows a failed decision inside the sheet without disabling retry", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      React.createElement(PermissionSheet, {
        open: true,
        request: {
          sessionId: "s",
          requestId: "p",
          toolName: "shell",
          toolArgs: {},
        },
        error: "Could not submit. Try again.",
        onAllow: vi.fn(),
        onDeny: vi.fn(),
        onAlwaysAllow: vi.fn(),
      })
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not submit. Try again."
    );
    expect(host.querySelectorAll("button:disabled")).toHaveLength(0);
  });
  it.each([false, true])(
    "disables decisions only when request detail is incomplete (%s)",
    (truncated) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        React.createElement(PermissionSheet, {
          open: true,
          request: {
            sessionId: "s",
            requestId: "p",
            toolName: "run_shell",
            toolArgs: { command: "pwd" },
            toolArgsTruncated: truncated,
          },
          notice: truncated
            ? "Check the complete request on Desktop"
            : undefined,
          onAllow: vi.fn(),
          onDeny: vi.fn(),
          onAlwaysAllow: vi.fn(),
        })
      );
      expect(host.querySelectorAll("button")).toHaveLength(3);
      expect(host.querySelectorAll("button:disabled")).toHaveLength(
        truncated ? 3 : 0
      );
      expect(host.querySelector('[role="status"]') != null).toBe(truncated);
    }
  );
});
