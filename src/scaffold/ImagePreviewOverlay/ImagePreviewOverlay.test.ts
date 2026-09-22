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
  Add01Icon: "Add01Icon",
  MinusSignIcon: "MinusSignIcon",
  ArrowLeft01Icon: "ArrowLeft01Icon",
  ArrowRight01Icon: "ArrowRight01Icon",
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

  function render(
    props: Partial<React.ComponentProps<typeof ImagePreviewOverlay>> = {}
  ) {
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
    expect(button("imagePreview.downloadImage")).not.toBeNull();
    expect(button("tooltips.zoomIn")).not.toBeNull();
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
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
    );
    expect(onClose).not.toHaveBeenCalled();
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  function navigation(label: string) {
    return Array.from(document.body.querySelectorAll("button")).find(
      (item) => item.getAttribute("aria-label") === label
    )!;
  }

  const images = [
    { src: "/one.png", fileName: "one.png" },
    { src: "/two.png", fileName: "two.png" },
    { src: "/three.png", fileName: "three.png" },
  ];

  it("uses modal header and footer outside the image body", () => {
    render({ images, resolveImage: vi.fn() });
    const body = document.body.querySelector(".liquid-modal-body")!;
    expect(body.querySelector("img")).not.toBeNull();
    expect(body.querySelector("button")).toBeNull();
    expect(navigation("actions.previous").disabled).toBe(true);
    expect(navigation("actions.next").disabled).toBe(false);
    expect(document.body.textContent).toContain("1 / 3");
  });

  it("loads only the selected image, supports arrow keys and bounds navigation", async () => {
    const resolveImage = vi.fn(async (src: string) => `data:image/png,${src}`);
    render({ images, resolveImage });
    expect(resolveImage).not.toHaveBeenCalled();
    await act(async () => navigation("actions.next").click());
    expect(resolveImage.mock.calls).toEqual([["/two.png"]]);
    expect(document.body.querySelector("img")!.src).toContain("/two.png");
    await act(async () =>
      navigation("actions.next").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    );
    expect(navigation("actions.next").disabled).toBe(true);
    expect(document.body.textContent).toContain("3 / 3");
    await act(async () =>
      navigation("actions.previous").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
      )
    );
    expect(document.body.textContent).toContain("2 / 3");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("two.png");
        expect(this.href).toContain("/two.png");
      });
    act(() => button("imagePreview.downloadImage").click());
    expect(click).toHaveBeenCalledOnce();
  });

  it("discards late results and releases only owned image URLs", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    let finish!: (src: string) => void;
    const resolveImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        })
    );
    render({ images, resolveImage });
    act(() => navigation("actions.next").click());
    expect(button("imagePreview.downloadImage").disabled).toBe(true);
    act(() => navigation("actions.previous").click());
    await act(async () => finish("blob:late"));
    expect(document.body.querySelector("img")!.getAttribute("src")).toBe(
      dataUrl
    );
    expect(revoke).toHaveBeenCalledWith("blob:late");
    act(() => navigation("actions.next").click());
    await act(async () => finish("blob:owned"));
    act(() => root.render(null));
    expect(revoke).toHaveBeenCalledWith("blob:owned");
  });

  it("does not revoke caller-owned blob URLs when navigating away", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    render({
      images: [images[0], { src: "blob:borrowed" }],
      resolveImage: async (src) => src,
    });
    await act(async () => navigation("actions.next").click());
    act(() => root.render(null));
    expect(revoke).not.toHaveBeenCalled();
  });

  it("keeps navigation available after a failed read or image decode", async () => {
    render({
      images,
      resolveImage: vi.fn().mockRejectedValue(new Error("missing")),
    });
    await act(async () => navigation("actions.next").click());
    expect(document.body.textContent).toContain("errors.failedToLoad");
    expect(button("imagePreview.copyImage").disabled).toBe(true);
    act(() => navigation("actions.previous").click());
    expect(document.body.querySelector("img")).not.toBeNull();
    act(() =>
      document.body.querySelector("img")!.dispatchEvent(new Event("error"))
    );
    expect(document.body.textContent).toContain("errors.failedToLoad");
    expect(button("imagePreview.downloadImage").disabled).toBe(true);
  });
  it("zooms with the drag slider without reloading images and resets on navigation", async () => {
    const resolveImage = vi.fn(async () => "data:image/png,next");
    render({ images, resolveImage });
    const slider = document.body.querySelector<HTMLElement>('[role="slider"]')!;
    const rail = document.body.querySelector<HTMLElement>(".slider-rail")!;
    vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 375,
      height: 20,
    } as DOMRect);
    act(() =>
      slider.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 })
      )
    );
    act(() =>
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 175, bubbles: true })
      )
    );
    act(() =>
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    );
    expect(slider.getAttribute("aria-valuenow")).toBe("200");
    expect(slider.getAttribute("aria-label")).toBe("tooltips.zoomIn");
    expect(slider.getAttribute("aria-valuetext")).toBe("200%");
    expect(button("tooltips.resetZoom").style.borderRadius).toBe("100px");
    expect(
      document.body.querySelector<HTMLElement>("[data-image-viewport] > div")!
        .style.width
    ).toBe("200%");
    expect(resolveImage).not.toHaveBeenCalled();
    act(() =>
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    );
    expect(document.body.textContent).toContain("1 / 3");
    act(() => button("tooltips.resetZoom").click());
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
    act(() => button("tooltips.zoomIn").click());
    expect(slider.getAttribute("aria-valuenow")).toBe("125");
    await act(async () => navigation("actions.next").click());
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
  });

  it("bounds zoom and keeps the floating controls outside the scroll area", () => {
    render();
    act(() => {
      for (let i = 0; i < 20; i++) button("tooltips.zoomIn").click();
    });
    expect(button("tooltips.zoomIn").disabled).toBe(true);
    expect(
      document.body
        .querySelector<HTMLElement>('[role="slider"]')!
        .getAttribute("aria-valuenow")
    ).toBe("400");
    act(() => {
      for (let i = 0; i < 20; i++) button("tooltips.zoomOut").click();
    });
    expect(button("tooltips.zoomOut").disabled).toBe(true);
    expect(
      document.body
        .querySelector<HTMLElement>('[role="slider"]')!
        .getAttribute("aria-valuenow")
    ).toBe("25");
    expect(
      document.body.querySelector('[data-image-viewport] [role="slider"]')
    ).toBeNull();
  });
  it("pinches with ctrl-wheel, coalesces frames and leaves ordinary scrolling alone", () => {
    let flush!: FrameRequestCallback;
    const raf = vi.fn((callback: FrameRequestCallback) => {
      flush = callback;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render();
    const viewport = document.body.querySelector("[data-image-viewport]")!;
    const scroll = new WheelEvent("wheel", { deltaY: 20, cancelable: true });
    act(() => viewport.dispatchEvent(scroll));
    expect(scroll.defaultPrevented).toBe(false);
    expect(raf).not.toHaveBeenCalled();
    const pinch = new WheelEvent("wheel", {
      deltaY: -20,
      ctrlKey: true,
      cancelable: true,
    });
    act(() => {
      viewport.dispatchEvent(pinch);
      viewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -20,
          ctrlKey: true,
          cancelable: true,
        })
      );
    });
    expect(pinch.defaultPrevented).toBe(true);
    expect(raf).toHaveBeenCalledTimes(1);
    act(() => flush(0));
    expect(button("tooltips.resetZoom").textContent).toBe("149%");
  });

  it("handles WebKit scale gestures without applying duplicate wheel zoom", () => {
    let flush!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      flush = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render();
    const viewport = document.body.querySelector("[data-image-viewport]")!;
    const change = new Event("gesturechange", { cancelable: true });
    Object.defineProperty(change, "scale", { value: 2 });
    act(() => {
      viewport.dispatchEvent(new Event("gesturestart", { cancelable: true }));
      viewport.dispatchEvent(change);
      viewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          ctrlKey: true,
          cancelable: true,
        })
      );
      flush(0);
    });
    expect(change.defaultPrevented).toBe(true);
    expect(button("tooltips.resetZoom").textContent).toBe("200%");
    act(() =>
      viewport.dispatchEvent(new Event("gestureend", { cancelable: true }))
    );
  });

  it("cancels pending pinch work and detaches listeners on close", () => {
    const raf = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    render();
    const viewport = document.body.querySelector("[data-image-viewport]")!;
    act(() =>
      viewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -20,
          ctrlKey: true,
          cancelable: true,
        })
      )
    );
    act(() => root.render(null));
    expect(cancel).toHaveBeenCalledWith(7);
    const afterClose = new WheelEvent("wheel", {
      deltaY: -20,
      ctrlKey: true,
      cancelable: true,
    });
    viewport.dispatchEvent(afterClose);
    expect(afterClose.defaultPrevented).toBe(false);
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
