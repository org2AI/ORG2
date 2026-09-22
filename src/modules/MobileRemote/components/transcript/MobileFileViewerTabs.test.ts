// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import MobileFileViewer from "./MobileFileViewer";
import type { MobileFileTarget } from "./mobileFileTool";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../platform/MobileRemotePlatformContext", async () => {
  const { createBrowserMobileRemotePlatform } =
    await import("../../platform/browser");
  const platform = createBrowserMobileRemotePlatform();
  return { useMobileRemotePlatform: () => platform };
});
vi.mock("./MobileReadonlyEditor", () => ({
  default: ({ content }: { content: string }) =>
    React.createElement("pre", null, content),
}));

const targets: MobileFileTarget[] = [
  {
    targetIndex: 2,
    filePath: "src/README.md",
    fileName: "README.md",
    content: "source docs",
  },
  {
    targetIndex: 7,
    filePath: "test/README.md",
    fileName: "README.md",
    content: "test docs",
  },
  {
    targetIndex: 11,
    filePath: "config/a-very-long-config-file-name.toml",
    fileName: "a-very-long-config-file-name.toml",
    content: "config = true",
  },
];
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

async function mount(files = targets) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const selected = vi.fn();
  function Harness() {
    const [index, setIndex] = useState(files[0]!.targetIndex);
    return React.createElement(MobileFileViewer, {
      target: files.find((file) => file.targetIndex === index)!,
      targets: files,
      onSelect: (next) => {
        selected(next);
        setIndex(next);
      },
      truncated: false,
    });
  }
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(async () => {
    root.render(React.createElement(Harness));
  });
  return { host, selected };
}

it("connects file tabs to the selected document, distinguishing duplicate basenames", async () => {
  const { host, selected } = await mount();
  const tabs = Array.from(
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  );
  expect(
    host.querySelector('[role="tablist"]')?.getAttribute("aria-label")
  ).toBe("fileViewer.files");
  expect(tabs).toHaveLength(3);
  expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  expect(tabs[1]!.getAttribute("aria-label")).toBe("test/README.md");
  expect(tabs[2]!.title).toBe(targets[2]!.filePath);
  await act(async () => tabs[1]!.click());
  const panel = host.querySelector('[role="tabpanel"]')!;
  expect(selected).toHaveBeenCalledWith(7);
  expect(panel.textContent).toBe("test docs");
  expect(panel.getAttribute("aria-labelledby")).toBe(tabs[1]!.id);
  expect(tabs[1]!.getAttribute("aria-controls")).toBe(panel.id);
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
});

it("moves focus and selection using arrows, Home and End without treating them as array indices", async () => {
  const { host, selected } = await mount();
  const tabs = Array.from(
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  );
  async function key(from: number, key: string, to: number) {
    tabs[from]!.focus();
    await act(async () => {
      tabs[from]!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(tabs[to]);
    expect(tabs[to]!.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toBe(
      targets[to]!.content
    );
  }
  await key(0, "ArrowRight", 1);
  await key(1, "End", 2);
  await key(2, "ArrowRight", 0);
  await key(0, "ArrowLeft", 2);
  await key(2, "Home", 0);
  expect(selected.mock.calls.map(([index]) => index)).toEqual([
    7, 11, 2, 11, 2,
  ]);
});

it("keeps a single file readable without an orphan tab panel", async () => {
  const { host } = await mount([targets[0]!]);
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.querySelector('[role="tabpanel"]')).toBeNull();
  expect(host.querySelector("[data-mobile-file-document]")?.textContent).toBe(
    "source docs"
  );
});
