// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import OutputImageGallery from "../OutputImageGallery";

let container: HTMLDivElement;
let root: Root;
const images = ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("puts thumbnails on the left and switches the full uncropped preview", async () => {
  await act(async () =>
    root.render(createElement(OutputImageGallery, { images }))
  );
  const section = container.querySelector("section")!;
  expect(section.firstElementChild?.getAttribute("data-testid")).toBe(
    "output-image-thumbnails"
  );
  const choices = container.querySelectorAll<HTMLButtonElement>(
    "button[aria-pressed]"
  );
  expect(choices).toHaveLength(2);
  expect(choices[0].getAttribute("aria-pressed")).toBe("true");
  await act(async () => choices[1].click());
  expect(choices[1].getAttribute("aria-pressed")).toBe("true");
  const preview = section.lastElementChild?.querySelector("img");
  expect(preview?.getAttribute("src")).toBe(images[1]);
  expect(preview?.className).toContain("object-contain");
  await act(async () =>
    root.render(createElement(OutputImageGallery, { images: [images[0]] }))
  );
  expect(container.querySelector("button[aria-pressed]")).toBeNull();
  expect(container.querySelector("img")?.getAttribute("src")).toBe(images[0]);
});
