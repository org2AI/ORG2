// @vitest-environment jsdom
import React, { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptItem } from "../../lib/transcriptReducer";
import {
  MobileRemotePlatformProvider,
  type MobileRemotePlatformProviderProps,
} from "../../platform/MobileRemotePlatformContext";
import { createBrowserMobileRemotePlatform } from "../../platform/browser";
import { MobileToolDetailModal } from "./MobileToolDetailModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const command: TranscriptItem = {
  id: "command-preview",
  kind: "tool",
  text: "run_shell",
  toolCanonical: "run_shell",
  toolStatus: "completed",
  toolData: {
    kind: "shell",
    command: "pnpm test",
    output: "Checks passed",
    exitCode: 0,
    isFailure: false,
  },
};

function Harness({ item }: { item: TranscriptItem }) {
  const [open, setOpen] = useState(false);
  return React.createElement(
    MobileRemotePlatformProvider,
    {
      platform: createBrowserMobileRemotePlatform(),
    } as MobileRemotePlatformProviderProps,
    React.createElement("button", { onClick: () => setOpen(true) }, "Preview"),
    React.createElement(MobileToolDetailModal, {
      item,
      open,
      onClose: () => setOpen(false),
    })
  );
}

describe("Mobile tool fullscreen preview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function open(item = command) {
    await act(async () => root.render(React.createElement(Harness, { item })));
    const trigger = container.querySelector("button")!;
    trigger.focus();
    await act(async () => trigger.click());
    return trigger;
  }

  it("opens an edge-to-edge named dialog and Escape restores the mounted conversation", async () => {
    const trigger = await open();
    expect(
      document.querySelector(".mobile-tool-preview.modal-fullscreen")
    ).not.toBeNull();
    expect(document.querySelector(".orgii-bottom-sheet-panel")).toBeNull();
    expect(
      document.querySelector('[role="dialog"]')?.getAttribute("aria-label")
    ).toBeTruthy();
    expect(
      document.querySelector(".mobile-tool-preview__body")?.textContent
    ).toContain("Checks passed");
    const terminal = document.querySelector(
      '[data-mobile-tool-detail-kind="shell"]'
    );
    expect(terminal?.getAttribute("data-mobile-tool-detail-state")).toBe(
      "done"
    );
    expect(terminal?.textContent).toContain("$pnpm test");
    expect(terminal?.textContent).toContain("Checks passed");
    expect(document.querySelector(".mobile-tool-preview__section")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector("button")).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps streaming shell output visible and announces updates", async () => {
    await open({
      ...command,
      toolStatus: "running",
      toolData: {
        kind: "shell",
        command: "pnpm test --watch",
        streamOutput: "Running checks…",
        isFailure: false,
      },
    });

    const terminal = document.querySelector(
      '[data-mobile-tool-detail-kind="shell"]'
    );
    expect(terminal?.getAttribute("data-mobile-tool-detail-state")).toBe(
      "running"
    );
    expect(terminal?.textContent).toContain("pnpm test --watch");
    const output = terminal?.querySelector(".mobile-terminal-detail__output");
    expect(output?.textContent).toContain("Running checks…");
    expect(output?.getAttribute("aria-live")).toBe("polite");
  });

  it("shows a failed shell exit code without exposing raw metadata", async () => {
    await open({
      ...command,
      toolStatus: "failed",
      toolDataTruncated: true,
      toolData: {
        kind: "shell",
        command: "pnpm test",
        output: "Tests failed",
        exitCode: 7,
        isFailure: true,
      },
    });

    const terminal = document.querySelector(
      '[data-mobile-tool-detail-kind="shell"]'
    );
    expect(terminal?.getAttribute("data-mobile-tool-detail-state")).toBe(
      "failed"
    );
    expect(terminal?.textContent).toContain("Tests failed");
    expect(terminal?.textContent).toContain("exit 7");
    expect(terminal?.textContent).toContain("transcript.tools.truncated");
    expect(document.querySelector(".mobile-tool-preview__section")).toBeNull();
  });

  it("keeps explicit close reachable for empty results and allows reopening", async () => {
    const trigger = await open({ ...command, toolData: undefined });
    await act(async () => {
      (
        document.querySelector(
          '[aria-label="transcript.tools.closeDetails"]'
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => trigger.click());
    expect(document.querySelector(".mobile-tool-preview")).not.toBeNull();
  });

  it("shows the complete search command with mobile detail typography", async () => {
    const fullCommand =
      "rg -n 'struct AgentMessageRow|tool_output' src/modules/MobileRemote";
    await open({
      ...command,
      toolCanonical: "code_search",
      toolSummary: fullCommand,
      toolData: {
        kind: "search",
        query: "struct AgentMessageRow|tool_output",
        totalMatches: 12,
        results: [
          {
            file: "src/message.ts",
            line: 42,
            content: "struct AgentMessageRow",
          },
        ],
      },
    });

    const search = document.querySelector(
      '[data-mobile-tool-detail-kind="search"]'
    );
    expect(search?.textContent).toContain(fullCommand);
    expect(search?.textContent).toContain(
      "src/message.ts:42  struct AgentMessageRow"
    );
    expect(search?.textContent).not.toContain("...");
    expect(
      document.querySelector('[data-mobile-tool-detail-kind="generic"]')
    ).toBeNull();
    expect(
      document
        .querySelector(".mobile-tool-preview__status")
        ?.classList.contains("mobile-type-caption")
    ).toBe(true);
  });

  it("keeps unsupported tools on the explicit generic detail fallback", async () => {
    await open({
      ...command,
      toolCanonical: "custom_inspector",
      toolSummary: "Inspect workspace state",
      toolData: {
        kind: "unknown",
        action: "inspect",
        scope: "workspace",
      },
    });

    const generic = document.querySelector(
      '[data-mobile-tool-detail-kind="generic"]'
    );
    expect(generic?.textContent).toContain("Inspect workspace state");
    expect(generic?.textContent).toContain("transcript.tools.details");
    expect(generic?.textContent).toContain('"scope": "workspace"');
  });

  it("preserves readonly file selection and truncation notice without executing anything", async () => {
    await open({
      ...command,
      toolCanonical: "apply_patch",
      toolDataTruncated: true,
      toolData: {
        kind: "edit",
        filePath: "src/a.ts",
        fileName: "a.ts",
        language: "typescript",
        isDeleted: false,
        applyPatchSegments: [
          {
            filePath: "src/a.ts",
            fileName: "a.ts",
            newContent: "const a = 1;",
            language: "typescript",
            isDeleted: false,
            applyPatchSegments: [],
          },
          {
            filePath: "src/b.ts",
            fileName: "b.ts",
            newContent: "const b = 2;",
            language: "typescript",
            isDeleted: false,
            applyPatchSegments: [],
          },
        ],
      },
    });
    const target = document.querySelector(
      '[data-mobile-file-target="src/b.ts"]'
    ) as HTMLButtonElement;
    await act(async () => target.click());
    expect(target.getAttribute("role")).toBe("tab");
    expect(target.getAttribute("aria-selected")).toBe("true");
    expect(target.tabIndex).toBe(0);
    expect(
      document.querySelectorAll('[role="tab"][aria-selected="true"]')
    ).toHaveLength(1);
    expect(document.querySelector("[data-mobile-open-file]")).toBeNull();
    expect(
      document.querySelector('[data-mobile-file-document="src/b.ts"]')
    ).not.toBeNull();
    expect(
      document.querySelector(".mobile-file-viewer__body")?.textContent
    ).toContain("transcript.tools.truncated");
  });
});
