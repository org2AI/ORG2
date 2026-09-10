// @vitest-environment jsdom
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ActionMenuSurface } from "@src/components/Dropdown/ActionMenuSurface";

import DocumentOpenSubmenu from "./DocumentOpenSubmenu";
import { loadDocumentApplications, openDocument } from "./documentApplications";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: { name?: string }) =>
    options?.name ? `${key}: ${options.name}` : key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("@src/util/platform/tauri", () => ({ isMacOS: () => true }));
vi.mock("./documentApplications", () => ({
  loadDocumentApplications: vi
    .fn()
    .mockResolvedValue([
      { path: "/Applications/Preview.app", name: "Preview", isDefault: true },
    ]),
  openDocument: vi.fn().mockResolvedValue(undefined),
}));

it("discovers handlers only after opening the submenu and opens the chosen app", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        React.createElement(
          ActionMenuSurface,
          {
            panelRef: createRef<HTMLDivElement>(),
            onClose: close,
          },
          React.createElement(DocumentOpenSubmenu, {
            filePath: "/docs/report.pdf",
            onClose: close,
          })
        )
      )
    );
    expect(loadDocumentApplications).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector<HTMLElement>('[data-testid="file-open-in-submenu"]')!
        .click()
    );
    expect(loadDocumentApplications).toHaveBeenCalledWith("/docs/report.pdf");
    expect(container.textContent).not.toContain("documentOpen.defaultApp");
    const item = [
      ...container.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((node) => node.textContent?.includes("Preview"))!;
    await act(async () => item.click());
    expect(openDocument).toHaveBeenCalledWith(
      "/docs/report.pdf",
      "/Applications/Preview.app"
    );
    expect(close).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
