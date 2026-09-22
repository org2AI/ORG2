// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ImageActionsProvider,
  useImageAttachmentTarget,
} from "@src/components/ImageActions/context";

import ImagePreviewOverlay from ".";

const mocks = vi.hoisted(() => ({
  menu: vi.fn(),
  download: vi.fn(),
  read: vi.fn(),
  add: vi.fn(),
  focus: vi.fn(),
  close: vi.fn(),
  copy: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@src/util/platform/tauri/nativeMenuPopup", () => ({
  popupNativeMenu: mocks.menu,
}));
vi.mock(
  "@src/components/ImageActions/imageOperations",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@src/components/ImageActions/imageOperations")
    >()),
    downloadImage: mocks.download,
    readActionImage: mocks.read,
    copyNativeImage: mocks.copy,
  })
);
vi.mock("@src/components/Message", () => ({
  default: { success: mocks.success, error: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Target() {
  const targetRef = useImageAttachmentTarget();
  useEffect(() => {
    if (!targetRef) return;
    const controller = new AbortController();
    targetRef.current = {
      signal: controller.signal,
      add: mocks.add,
      focus: mocks.focus,
    };
    return () => {
      controller.abort();
      targetRef.current = null;
    };
  }, [targetRef]);
  return null;
}

describe("image preview native menu", () => {
  let root: Root;
  let container: HTMLDivElement;
  let items: { text: string; enabled: boolean; action: () => void }[];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.add.mockResolvedValue(1);
    mocks.read.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    mocks.download.mockResolvedValue(undefined);
    mocks.menu.mockImplementation(async ({ buildItems }) => {
      items = await buildItems();
      return { status: "closed" };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(
    props: Partial<React.ComponentProps<typeof ImagePreviewOverlay>> = {}
  ) {
    await act(async () =>
      root.render(
        createElement(
          ImageActionsProvider,
          {},
          createElement(Target),
          createElement(ImagePreviewOverlay, {
            dataUrl: "blob:first",
            originalRef: "/tmp/first.png",
            fileName: "first.png",
            onClose: mocks.close,
            ...props,
          })
        )
      )
    );
  }
  async function menu() {
    await act(async () =>
      document
        .querySelector("[data-image-viewport]")!
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
        )
    );
  }
  it("adds the displayed image and closes the modal before focusing the composer", async () => {
    await render();
    await menu();
    await act(async () => items[0].action());
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: "first.png" }),
      expect.any(AbortSignal)
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.focus.mock.invocationCallOrder[0]
    );
  });
  it("invalidates an old menu on gallery navigation and downloads the selected original", async () => {
    await render({
      images: [
        { src: "/tmp/first.png", fileName: "first.png" },
        { src: "/tmp/second.jpg", fileName: "second.jpg" },
      ],
      resolveImage: async () => "blob:second",
    });
    await menu();
    const staleDownload = items[3].action;
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="actions.next"]')!
        .click()
    );
    await act(async () => staleDownload());
    expect(mocks.download).not.toHaveBeenCalled();
    await menu();
    await act(async () => items[3].action());
    expect(mocks.download).toHaveBeenCalledWith(
      {
        src: "blob:second",
        fileName: "second.jpg",
        localPath: "/tmp/second.jpg",
      },
      expect.any(AbortSignal)
    );
  });
  it("suppresses stale clipboard completion feedback after changing the image", async () => {
    let finish!: () => void;
    mocks.copy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render();
    await menu();
    await act(async () => items[1].action());
    await render({
      dataUrl: "blob:replacement",
      originalRef: "/tmp/replacement.png",
    });
    await act(async () => finish());
    expect(mocks.copy.mock.calls[0][1].aborted).toBe(true);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("respects draft and copy restrictions in the menu as well as the toolbar", async () => {
    await render({ allowAddToChat: false, showCopyButton: false });
    await menu();
    expect(items.map((item) => item.text)).toEqual([
      expect.stringMatching(/^actions.revealIn/),
      "imageActions.downloadCopy",
    ]);
  });
});
