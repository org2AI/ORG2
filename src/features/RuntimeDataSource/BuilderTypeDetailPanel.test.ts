// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BuilderTypeDetailModal, {
  BUILDER_TYPE_MODAL_MIN_BODY,
  BUILDER_TYPE_MODAL_WIDTH,
} from "./BuilderTypeDetailPanel";
import { getBuilderType } from "./builderTypes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.endsWith(".description")
        ? `${key}。`
        : key.endsWith(".agentTip")
          ? `${key}.`
          : key,
  }),
}));

describe("BuilderTypeDetailModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the selected type profile and agent guidance", () => {
    const type = getBuilderType("EAWH");
    const onClose = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    expect(type).toBeDefined();

    act(() =>
      root.render(
        createElement(BuilderTypeDetailModal, {
          type: type!,
          onClose,
          onPrevious,
          onNext,
        })
      )
    );

    const detail = document.body.querySelector(
      '[data-testid="builder-type-detail"]'
    );
    expect(detail?.textContent).toContain("EAWH");
    expect(detail?.textContent).toContain("Swarm Founder");
    expect(detail?.querySelectorAll("li")).toHaveLength(8);
    expect(detail?.textContent).not.toContain("description。");
    expect(detail?.textContent).not.toContain("agentTip.");
    expect(
      detail?.querySelector('[data-testid="builder-type-avatar-EAWH"]')
    ).not.toBeNull();

    act(() =>
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="builder-type-previous"]'
        )
        ?.click()
    );
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[data-testid="builder-type-next"]')
        ?.click()
    );

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();

    const previous = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="builder-type-previous"]'
    );
    const next = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="builder-type-next"]'
    );
    expect(previous?.textContent).toBe("");
    expect(next?.textContent).toBe("");

    act(() =>
      document.body
        .querySelector<HTMLButtonElement>(
          '.liquid-modal-content button[title="Close"]'
        )
        ?.click()
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("draws no card chrome inside the dialog and keeps one dialog size", () => {
    const type = getBuilderType("MDFS");
    expect(type).toBeDefined();

    act(() =>
      root.render(
        createElement(BuilderTypeDetailModal, {
          type: type!,
          onClose: vi.fn(),
          onPrevious: vi.fn(),
          onNext: vi.fn(),
        })
      )
    );

    // The dialog is the surface; the content adds no second border or fill.
    const detail = document.body.querySelector<HTMLElement>(
      '[data-testid="builder-type-detail"]'
    );
    expect(detail?.className ?? "").not.toMatch(
      /\bborder\b|\brounded|\bbg-|\bp-\d/
    );

    // Stepping through types keeps the dialog the same size.
    const body = document.body.querySelector<HTMLElement>(
      '[data-testid="builder-type-detail-modal"]'
    );
    expect(body?.className).toContain(BUILDER_TYPE_MODAL_MIN_BODY);
    expect(
      document.body.querySelector<HTMLElement>(".liquid-modal-content")?.style
        .width
    ).toBe(`${BUILDER_TYPE_MODAL_WIDTH}px`);
  });
});
