// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ImagePreviewOverlay from ".";

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  overlay: vi.fn(),
  copyIcon: "Copy01Icon",
}));

vi.mock("@src/components/Message", () => ({
  default: { success: mocks.success, error: mocks.error },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/store/ui/overlayLayerAtom", () => ({
  useOverlayLayer: mocks.overlay,
}));
vi.mock("@src/icons", () => ({
  Copy01Icon: mocks.copyIcon,
  Download01Icon: "Download01Icon",
  Cancel01Icon: "Cancel01Icon",
  HugeiconsIcon: ({ icon }: { icon: string }) =>
    createElement("span", { "data-mocked-icon": icon }),
}));

class MockClipboardItem {
  constructor(readonly data: Record<string, Promise<Blob>>) {}
}

const dataUrl = "data:image/jpeg;base64,cHJldmlldw==";

describe("ImagePreviewOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;
  let finishConversion: BlobCallback;
  let canvas: HTMLCanvasElement;
  const drawImage = vi.fn();
  const write = vi.fn<(items: MockClipboardItem[]) => Promise<void>>();
  const writeText = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    write.mockImplementation(async (items) => {
      await items[0].data["image/png"];
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, callback) {
        // Capture the actual canvas receiving toBlob to verify its dimensions.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        canvas = this;
        finishConversion = callback;
      }
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function render(props: { fileName?: string; showCopyButton?: boolean } = {}) {
    act(() => {
      root.render(
        createElement(ImagePreviewOverlay, { dataUrl, onClose, ...props })
      );
    });
    const image = document.body.querySelector("img")!;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 640 },
      naturalHeight: { configurable: true, value: 480 },
    });
    return image;
  }

  function button(label: string) {
    const element = document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`
    );
    expect(element).not.toBeNull();
    return element!;
  }

  function clickCopy() {
    act(() => button("imagePreview.copyImage").click());
  }

  it("shows Copy01Icon and the copy-image label/title by default", () => {
    render();
    const copy = button("imagePreview.copyImage");
    expect(copy.title).toBe("imagePreview.copyImage");
    expect(
      copy.querySelector('[data-mocked-icon="Copy01Icon"]')
    ).not.toBeNull();
    expect(
      document.body.querySelector('[role="dialog"]')?.getAttribute("aria-modal")
    ).toBe("true");
    expect(mocks.overlay).toHaveBeenCalledWith(true);
  });

  it("still permits explicitly hiding the copy button", () => {
    render({ showCopyButton: false });
    expect(
      document.body.querySelector('[aria-label="imagePreview.copyImage"]')
    ).toBeNull();
    expect(document.body.querySelectorAll("button")).toHaveLength(2);
  });

  it("writes the PNG promise synchronously during the click, before conversion finishes", async () => {
    const image = render();
    clickCopy();

    // No await or toBlob callback before this assertion: WebKit requires the
    // clipboard write to retain the original user-activation call stack.
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png"
    );
    const [item] = write.mock.calls[0][0];
    expect(item).toBeInstanceOf(MockClipboardItem);
    expect(Object.keys(item.data)).toEqual(["image/png"]);
    expect(item.data["image/png"]).toBeInstanceOf(Promise);
    expect(mocks.success).not.toHaveBeenCalled();

    const png = new Blob(["converted pixels"], { type: "image/png" });
    await act(async () => finishConversion(png));

    await expect(item.data["image/png"]).resolves.toBe(png);
    expect(mocks.success.mock.calls).toEqual([
      ["imagePreview.copiedToClipboard"],
    ]);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports clipboard rejection without a success notification", async () => {
    write.mockRejectedValueOnce(new Error("Permission denied"));
    render();
    await act(async () => {
      clickCopy();
      finishConversion(new Blob(["pixels"], { type: "image/png" }));
    });
    expect(mocks.error.mock.calls).toEqual([["errors.failedToCopy"]]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each([
    { complete: false, naturalWidth: 640, naturalHeight: 480 },
    { complete: true, naturalWidth: 0, naturalHeight: 480 },
    { complete: true, naturalWidth: 640, naturalHeight: 0 },
  ])("rejects an image that is not ready: %o", async (state) => {
    const image = render();
    for (const [key, value] of Object.entries(state)) {
      Object.defineProperty(image, key, { configurable: true, value });
    }
    await act(async () => clickCopy());
    expect(write).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(drawImage).not.toHaveBeenCalled();
    expect(mocks.error.mock.calls).toEqual([["errors.failedToCopy"]]);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("reports a failed PNG conversion and releases the canvas", async () => {
    render();
    clickCopy();
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => finishConversion(null));
    await expect(write.mock.calls[0][0][0].data["image/png"]).rejects.toThrow();
    expect(mocks.error.mock.calls).toEqual([["errors.failedToCopy"]]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("handles conversion failure after an early clipboard rejection", async () => {
    write.mockRejectedValueOnce(new Error("Permission denied"));
    render();
    await act(async () => clickCopy());
    await act(async () => finishConversion(null));
    expect(mocks.error.mock.calls).toEqual([["errors.failedToCopy"]]);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each(["missing context", "drawing throws", "encoding throws"])(
    "reports conversion setup failure: %s",
    async (failure) => {
      render();
      if (failure === "missing context") {
        vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(
          null
        );
      } else if (failure === "drawing throws") {
        drawImage.mockImplementationOnce(() => {
          throw new Error("Tainted canvas");
        });
      } else {
        vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(
          () => {
            throw new Error("Encoding failed");
          }
        );
      }
      await act(async () => clickCopy());
      expect(mocks.error.mock.calls).toEqual([["errors.failedToCopy"]]);
      expect(mocks.success).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, "photo.jpg"])(
    "downloads the original image with filename %s",
    (fileName) => {
      render({ fileName });
      const linkClick = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          expect(this.href).toBe(dataUrl);
          expect(this.download).toBe(fileName || "image.png");
          expect(this.isConnected).toBe(true);
        });
      act(() => button("imagePreview.downloadImage").click());
      expect(linkClick).toHaveBeenCalledTimes(1);
      expect(document.body.querySelector("a")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    }
  );

  it("closes on backdrop and close button, but not image or container clicks", () => {
    const image = render();
    act(() => {
      image.click();
      image.parentElement!.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() =>
      document.body.querySelector<HTMLDivElement>('[role="dialog"]')!.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => button("imagePreview.closePreview").click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes only on Escape and removes the keyboard handler on unmount", () => {
    render();
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
    );
    expect(onClose).not.toHaveBeenCalled();
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
