// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ChatImageThumbnail, ChatImageThumbnailRow } from ".";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  preview: vi.fn(),
  readTranscriptImage: vi.fn(),
}));

vi.mock("@src/api/tauri/externalHistory/sources/codexApp/images", () => ({
  readTranscriptImage: mocks.readTranscriptImage,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: mocks.readFile,
}));

vi.mock("@src/scaffold/ImagePreviewOverlay", () => ({
  default: (props: unknown) => {
    mocks.preview(props);
    return null;
  },
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

// jsdom has no object URLs; install deterministic ones so the tests can
// assert that local images are served as Blob URLs and released again.
const objectUrls = {
  created: 0,
  createObjectURL: vi.fn((_blob: Blob) => {
    objectUrls.created += 1;
    return `blob:mock-${objectUrls.created}`;
  }),
  revokeObjectURL: vi.fn(),
};

describe("ChatImageThumbnail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(URL, "createObjectURL", {
      value: objectUrls.createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: objectUrls.revokeObjectURL,
      configurable: true,
      writable: true,
    });
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("renders an unavailable placeholder when a local image is missing", async () => {
    mocks.readFile.mockRejectedValueOnce(new Error("not found"));

    await act(async () => {
      root.render(
        createElement(ChatImageThumbnail, {
          imageRef: "/tmp/missing-screenshot.png",
          alt: "Attached image 1",
        })
      );
    });

    expect(mocks.readFile).toHaveBeenCalledWith("/tmp/missing-screenshot.png");
    expect(
      container.querySelector('[data-image-state="unavailable"]')
    ).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders available data images immediately", async () => {
    await act(async () => {
      root.render(
        createElement(ChatImageThumbnail, {
          imageRef: "data:image/png;base64,c21hbGw=",
          alt: "Attached image 1",
        })
      );
    });

    expect(
      container.querySelector('[data-image-state="ready"]')
    ).not.toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,c21hbGw="
    );
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it.each(["https://example.com/screenshot.png", "blob:existing-image"])(
    "loads %s through the browser without copying bytes into JS",
    async (imageRef) => {
      await act(async () => {
        root.render(
          createElement(ChatImageThumbnail, { imageRef, alt: "Image" })
        );
      });
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        imageRef
      );
      expect(container.querySelector("img")?.getAttribute("loading")).toBe(
        "lazy"
      );
      expect(mocks.readFile).not.toHaveBeenCalled();
      expect(objectUrls.createObjectURL).not.toHaveBeenCalled();
    }
  );

  it("releases a local image that finishes after unmount", async () => {
    let resolve!: (bytes: Uint8Array) => void;
    mocks.readFile.mockReturnValueOnce(
      new Promise<Uint8Array>((done) => {
        resolve = done;
      })
    );
    await act(async () => {
      root.render(
        createElement(ChatImageThumbnail, {
          imageRef: "/tmp/late.png",
          alt: "Image",
        })
      );
    });
    await act(async () => {
      root.render(null);
    });
    await act(async () => {
      resolve(new Uint8Array([1, 2, 3]));
    });
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("loads transcript-backed thumbnails without reading protected screenshot files", async () => {
    mocks.readTranscriptImage.mockResolvedValueOnce(
      "data:image/png;base64,QUJD"
    );
    const imageRef =
      'orgii-transcript-image:["codexapp-one","codex-user-123","/protected/shot.png"]';
    await act(async () => {
      root.render(
        createElement(ChatImageThumbnail, { imageRef, alt: "Image" })
      );
    });
    expect(mocks.readTranscriptImage).toHaveBeenCalledWith({
      sessionId: "codexapp-one",
      turnId: "codex-user-123",
      originalRef: "/protected/shot.png",
    });
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,QUJD"
    );
  });

  it("serves local images as Blob URLs and releases them when the ref changes", async () => {
    mocks.readFile.mockResolvedValueOnce(new Uint8Array([9, 8, 7]));
    objectUrls.revokeObjectURL.mockClear();

    await act(async () => {
      root.render(
        createElement(ChatImageThumbnail, {
          imageRef: "/tmp/screenshot.png",
          alt: "Attached image 1",
        })
      );
    });

    const src = container.querySelector("img")?.getAttribute("src");
    expect(src).toMatch(/^blob:mock-\d+$/);
    const blob = objectUrls.createObjectURL.mock.calls.at(-1)?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("image/png");
    expect(objectUrls.revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(ChatImageThumbnail, {
          imageRef: "data:image/png;base64,c21hbGw=",
          alt: "Attached image 1",
        })
      );
    });

    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith(src);
  });
  it("opens the selected attachment through a focusable native button", () => {
    const images = ["data:image/png;base64,AA", "data:image/png;base64,BB"];
    act(() => root.render(createElement(ChatImageThumbnailRow, { images })));
    const second = container.querySelectorAll<HTMLButtonElement>("button")[1];
    expect(second.type).toBe("button");
    expect(second.tabIndex).toBe(0);
    second.focus();
    expect(document.activeElement).toBe(second);
    act(() => second.click());
    expect(mocks.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dataUrl: images[1],
        initialIndex: 1,
        images: images.map((src) => ({ src, fileName: undefined })),
        resolveImage: expect.any(Function),
      })
    );
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
