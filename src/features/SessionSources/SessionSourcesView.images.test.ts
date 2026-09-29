// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { extractSessionSources } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { SessionSourcesView } from "./SessionSourcesView";

const imageRuntime = vi.hoisted(() => ({
  mountedRef: vi.fn(),
  resolve: vi.fn(async () => "data:image/png;base64,RESOLVED"),
  overlay: vi.fn(),
}));
vi.mock("@src/engines/ChatPanel/ChatImageThumbnail", () => ({
  useResolvedImageSrc: (ref: string) => {
    imageRuntime.mountedRef(ref);
    return { src: "data:image/png;base64,THUMBNAIL", failed: false };
  },
  resolveImageSrc: imageRuntime.resolve,
}));
vi.mock("@src/scaffold/ImagePreviewOverlay", () => ({
  default: (props: unknown) => {
    imageRuntime.overlay(props);
    return React.createElement("div", { "data-testid": "image-gallery" });
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("shows readable image locations while preserving transcript identity through thumbnails and gallery navigation", async () => {
  const path = "/tmp/Readable Screenshot.png";
  const firstRef = `orgii-transcript-image:${JSON.stringify([
    "private-session-marker",
    "private-turn-marker",
    path,
  ])}`;
  const inlineRef = `orgii-transcript-image:${JSON.stringify([
    "private-session-marker",
    "other-turn-marker",
    "codex-inline-image:0",
  ])}`;
  const sources = extractSessionSources([
    { id: "user-message", text: "", images: [firstRef, inlineRef] },
  ]);
  await act(async () => {
    root.render(
      React.createElement(SessionSourcesView, {
        sources,
        onRetry: vi.fn(),
      })
    );
  });

  expect(host.textContent).toContain("Readable Screenshot.png");
  const visibleAndTooltipText = [
    host.textContent,
    ...[...host.querySelectorAll("[title], [aria-label]")].map(
      (element) =>
        `${element.getAttribute("title")} ${element.getAttribute("aria-label")}`
    ),
  ].join(" ");
  for (const internal of [
    "orgii-transcript-image:",
    "private-session-marker",
    "private-turn-marker",
    "codex-inline-image:",
  ]) {
    expect(visibleAndTooltipText).not.toContain(internal);
  }
  expect(imageRuntime.mountedRef).toHaveBeenCalledWith(firstRef);
  expect(imageRuntime.mountedRef).toHaveBeenCalledWith(inlineRef);

  await act(async () => {
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Readable Screenshot.png"]'
      )!
      .click();
  });

  expect(host.querySelector('[data-testid="image-gallery"]')).not.toBeNull();
  const overlay = imageRuntime.overlay.mock.lastCall![0] as {
    images: Array<{ src: string }>;
    initialIndex: number;
    resolveImage: (ref: string) => Promise<string | null>;
  };
  expect(overlay.images.map((image) => image.src)).toEqual([
    firstRef,
    inlineRef,
  ]);
  expect(overlay.initialIndex).toBe(0);
  await overlay.resolveImage(overlay.images[1].src);
  expect(imageRuntime.resolve).toHaveBeenCalledWith(inlineRef);
  expect(sources[0]).toMatchObject({ kind: "image", ref: firstRef });
});
