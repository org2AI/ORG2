// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Button from "@src/components/Button";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import { ChatImageThumbnail } from "@src/engines/ChatPanel/ChatImageThumbnail";
import { useImageMenuTarget } from "@src/engines/ChatPanel/InputArea/hooks/useImageMenuTarget";
import { useImageAttachment } from "@src/engines/ChatPanel/hooks/useInputArea/useImageAttachment";
import {
  type ChatImageAttachment,
  chatImageAttachmentsAtom,
} from "@src/store/ui/chatImageAtom";

import { ImageActionsProvider } from "./context";
import { useImageActions } from "./useImageActions";

const mocks = vi.hoisted(() => ({
  menu: vi.fn(),
  optimize: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  focus: vi.fn(),
}));
vi.mock("@src/util/platform/tauri/nativeMenuPopup", () => ({
  popupNativeMenu: mocks.menu,
}));
vi.mock("@src/util/optimization/imageOptimizer", () => ({
  optimizeImage: mocks.optimize,
}));
vi.mock("@src/components/Message", () => ({
  default: {
    success: mocks.success,
    error: mocks.error,
    warning: mocks.warning,
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/scaffold/ImagePreviewOverlay", () => ({ default: () => null }));

type MenuItem = { text: string; enabled: boolean; action: () => void };
const imageUrl = "data:image/png;base64,aGVsbG8=";
const optimized = {
  dataUrl: imageUrl,
  optimizedSize: 5,
  finalDimensions: { width: 1, height: 1 },
};

function Draft({
  sessionId,
  enabled,
}: {
  sessionId: string;
  enabled: boolean;
}) {
  const attachments = useImageAttachment(`owner-${sessionId}`);
  const input = useRef({ focus: mocks.focus } as unknown as ComposerInputRef);
  useImageMenuTarget({
    sessionId,
    enabled,
    add: attachments.handleImagePaste,
    input,
  });
  return createElement("textarea", {
    "aria-label": `draft-${sessionId}`,
    defaultValue: "keep my draft",
  });
}

function DraftImage() {
  const actions = useImageActions({ src: imageUrl }, { allowAdd: false });
  return createElement(
    Button,
    { onContextMenu: actions.onContextMenu, "aria-label": "draft image" },
    "image"
  );
}

function Surface({
  sessionId,
  enabled = true,
  imageRef = imageUrl,
}: {
  sessionId: string;
  enabled?: boolean;
  imageRef?: string;
}) {
  return createElement(
    ImageActionsProvider,
    {},
    createElement(ChatImageThumbnail, {
      imageRef,
      alt: `image-${sessionId}`,
    }),
    createElement(Draft, { sessionId, enabled }),
    createElement(DraftImage)
  );
}

describe("chat image menu through the production attachment boundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  let store: ReturnType<typeof createStore>;
  let items: MenuItem[];
  let fetchImage: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchImage = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["hello"], { type: "image/png" }),
    });
    vi.stubGlobal("fetch", fetchImage);
    mocks.optimize.mockResolvedValue(optimized);
    mocks.menu.mockImplementation(async ({ buildItems }) => {
      items = await buildItems();
      return { status: "closed" };
    });
    store = createStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  async function render(sessionId = "a", enabled = true, imageRef = imageUrl) {
    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Surface, { sessionId, enabled, imageRef }),
          createElement(Surface, { sessionId: "other" })
        )
      )
    );
  }
  async function menu(label = "image-a", keyboard = false) {
    const element = container.querySelector(`[aria-label="${label}"]`)!;
    await act(async () =>
      element.dispatchEvent(
        keyboard
          ? new KeyboardEvent("keydown", {
              key: "F10",
              shiftKey: true,
              bubbles: true,
              cancelable: true,
            })
          : new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
      )
    );
    return items;
  }
  async function add() {
    await act(async () => items[0].action());
  }

  it("adds to only the owning composer, keeps text and existing attachments, and focuses it", async () => {
    const existing = {
      id: "existing",
      dataUrl: imageUrl,
      fileName: "old.png",
      size: 5,
      width: 1,
      height: 1,
      ownerId: "owner-a",
    };
    store.set(chatImageAttachmentsAtom, [existing]);
    await render();
    await menu();
    expect(items.map((item) => item.text)).toEqual([
      "imageActions.addToChat",
      "imagePreview.copyImage",
      expect.stringMatching(/^actions.revealIn/),
      "imageActions.downloadCopy",
    ]);
    expect(items[0].enabled).toBe(true);
    expect(items[2].enabled).toBe(false);
    await add();
    expect(store.get(chatImageAttachmentsAtom)).toEqual([
      existing,
      expect.objectContaining({ ownerId: "owner-a", dataUrl: imageUrl }),
    ]);
    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="draft-a"]')!
        .value
    ).toBe("keep my draft");
    act(() => vi.runAllTimers());
    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledWith("imageActions.added");
  });

  it("does no reads while idle; supports keyboard menus and disables read-only targets", async () => {
    await render("a", false);
    expect(fetchImage).not.toHaveBeenCalled();
    await menu("image-a", true);
    expect(items[0].enabled).toBe(false);
    await add();
    expect(fetchImage).not.toHaveBeenCalled();
    expect(store.get(chatImageAttachmentsAtom)).toEqual([]);
    await menu("draft image");
    expect(items.map((item) => item.text)).not.toContain(
      "imageActions.addToChat"
    );
  });

  it("cancels a menu opened before switching sessions", async () => {
    await render();
    await menu();
    const oldAdd = items[0].action;
    await render("b");
    await act(async () => oldAdd());
    expect(fetchImage).not.toHaveBeenCalled();
    expect(store.get(chatImageAttachmentsAtom)).toEqual([]);
  });

  it("drops a late network result after switching sessions", async () => {
    let finish!: (value: unknown) => void;
    fetchImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await render();
    await menu();
    await add();
    await render("b");
    expect(fetchImage.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () =>
      finish({
        ok: true,
        blob: async () => new Blob(["hello"], { type: "image/png" }),
      })
    );
    expect(mocks.optimize).not.toHaveBeenCalled();
    expect(store.get(chatImageAttachmentsAtom)).toEqual([]);
  });

  it("cancels delayed focus when the owning composer switches", async () => {
    await render();
    await menu();
    await add();
    await render("b");
    act(() => vi.runAllTimers());
    expect(mocks.focus).not.toHaveBeenCalled();
  });

  it("drops late optimization when the image changes but the composer remains", async () => {
    let finish!: (value: typeof optimized) => void;
    mocks.optimize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await render();
    await menu();
    await add();
    await render("a", true, "data:image/png;base64,c2Vjb25k");
    await act(async () => finish(optimized));
    expect(store.get(chatImageAttachmentsAtom)).toEqual([]);
  });

  it("rejects stale writes after optimization and releases the target on unmount", async () => {
    let finish!: (value: typeof optimized) => void;
    mocks.optimize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await render();
    await menu();
    await add();
    await render("b");
    await act(async () => finish(optimized));
    expect(store.get(chatImageAttachmentsAtom)).toEqual([]);
    await menu("image-b");
    const oldAdd = items[0].action;
    await act(async () => root.render(null));
    await act(async () => oldAdd());
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it("single-flights repeated clicks, retains the five-image cap at commit, and allows retry after failure", async () => {
    fetchImage.mockRejectedValueOnce(new Error("offline"));
    await render();
    await menu();
    await add();
    expect(mocks.error).toHaveBeenCalledWith("imageActions.failed");
    let finish!: (value: typeof optimized) => void;
    mocks.optimize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await menu();
    await act(async () => {
      items[0].action();
      items[0].action();
    });
    expect(fetchImage).toHaveBeenCalledTimes(2);
    const full: ChatImageAttachment[] = Array.from({ length: 5 }, (_, i) => ({
      id: `${i}`,
      ownerId: "owner-a",
      dataUrl: imageUrl,
      fileName: "existing.png",
      width: 1,
      height: 1,
      size: 5,
    }));
    await act(async () => store.set(chatImageAttachmentsAtom, full));
    await act(async () => finish(optimized));
    expect(store.get(chatImageAttachmentsAtom)).toEqual(full);
    expect(mocks.warning).toHaveBeenCalledWith("chatImage.maxReached");
    await act(async () => store.set(chatImageAttachmentsAtom, []));
    await menu();
    await add();
    expect(store.get(chatImageAttachmentsAtom)).toHaveLength(1);
  });
});
