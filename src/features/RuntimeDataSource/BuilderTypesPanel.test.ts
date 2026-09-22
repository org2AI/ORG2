// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BuilderTypesPanel from "./BuilderTypesPanel";
import { RUNTIME_PAGE_TRACK } from "./RuntimePageLayout";
import { RUNTIME_SECTION_HEADER_HEIGHT } from "./RuntimeSectionHeader";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("BuilderTypesPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onBack: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onBack = vi.fn();
    act(() => root.render(createElement(BuilderTypesPanel, { onBack })));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the complete catalog and four-axis explainer", () => {
    expect(
      container.querySelectorAll('[data-testid^="builder-type-card-"]')
    ).toHaveLength(16);
    expect(container.textContent).toContain("M / E");
    expect(container.textContent).toContain("D / A");
    expect(container.textContent).toContain("F / W");
    expect(container.textContent).toContain("S / H");
  });

  it("separates the code, name, and two preference pairs in each card", () => {
    const systemsArchitect = container.querySelector(
      '[data-testid="builder-type-card-MDFS"]'
    );

    const textColumn = systemsArchitect?.lastElementChild;
    const lines = Array.from(textColumn?.children ?? []);
    expect(lines.slice(0, 2).map((line) => line.textContent)).toEqual([
      "MDFS",
      "Systems Architect",
    ]);
    expect(
      Array.from(lines[2]?.children ?? []).map((line) => line.textContent)
    ).toEqual([
      "types.letters.M.name · types.letters.D.name",
      "types.letters.F.name · types.letters.S.name",
    ]);
  });

  it("opens detail in a navigable modal without replacing the gallery", () => {
    const card = container.querySelector<HTMLButtonElement>(
      '[data-testid="builder-type-card-EAWH"]'
    );
    act(() => card?.click());

    expect(
      document.body.querySelector('[data-testid="builder-type-detail"]')
        ?.textContent
    ).toContain("EAWH");
    expect(
      container.querySelector('[data-testid="builder-types-gallery"]')
    ).not.toBeNull();

    const next = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="builder-type-next"]'
    );
    act(() => next?.click());

    expect(
      document.body.querySelector('[data-testid="builder-type-detail"]')
        ?.textContent
    ).toContain("MDFS");

    const close = document.body.querySelector<HTMLButtonElement>(
      '.liquid-modal-content button[title="Close"]'
    );
    act(() => close?.click());

    expect(
      document.body.querySelector('[data-testid="builder-type-detail-modal"]')
    ).toBeNull();

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="builder-types-back"]')
        ?.click()
    );
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders the gallery back control as an icon-only tertiary button", () => {
    const back = container.querySelector<HTMLButtonElement>(
      '[data-testid="builder-types-back"]'
    );

    expect(back?.textContent).toBe("");
    expect(back?.getAttribute("aria-label")).toBe("common:actions.back");
    expect(back?.className).toContain("text-text-2");
  });

  it("puts the gallery body on the same track as its header", () => {
    // The gallery used to centre on the bare 932px shell while its header sat
    // on the 900px content measure, so the cards ran 32px wider than every
    // other Runtime page.
    const header = container.querySelector<HTMLElement>(
      '[data-testid="builder-types-back"]'
    )?.parentElement;
    const body = container
      .querySelector<HTMLElement>('[data-testid="builder-types-gallery"]')
      ?.closest<HTMLElement>(".max-w-\\[932px\\]");

    expect(header?.className).toContain(RUNTIME_PAGE_TRACK);
    expect(body).not.toBeNull();
    expect(body?.className).toContain(RUNTIME_PAGE_TRACK);
    // The gutters live on that track, never on the scroll region around it.
    expect(body?.parentElement?.className).not.toMatch(/\bpx-\d/);
  });

  it("opens straight into the avatars, on the shared header height", () => {
    // The panel header names the surface; the gallery repeats neither that
    // title nor a hint above the grid.
    expect(container.textContent).not.toContain("types.galleryTitle");
    expect(container.textContent).not.toContain("types.galleryHint");

    const header = container.querySelector<HTMLElement>(
      '[data-testid="builder-types-back"]'
    )?.parentElement;
    expect(header?.className).toContain(RUNTIME_SECTION_HEADER_HEIGHT);
    expect(header?.className).not.toContain("min-h-10");
  });
});
