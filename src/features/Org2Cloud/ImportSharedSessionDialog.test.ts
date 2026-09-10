// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import ImportSharedSessionDialog from "./ImportSharedSessionDialog";
import { org2CloudPendingShareAtom } from "./org2CloudPendingShareAtom";

const input = vi.hoisted(() => ({ onChange: (_value: string) => {} }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/scaffold/GlobalSpotlight/shell", () => ({
  SpotlightShell: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) =>
    isOpen
      ? createElement("div", { "data-testid": "spotlight-shell" }, children)
      : null,
}));
vi.mock("@src/components/Textarea", () => ({
  default: (props: { onChange: (value: string) => void }) => {
    input.onChange = props.onChange;
    return createElement("textarea", { "data-testid": "share-input" });
  },
}));

const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
afterEach(() => {
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});

it("uses Spotlight chrome and preserves validation, import, and dismissal", () => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const store = createStore();
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (visible: boolean) =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(ImportSharedSessionDialog, { visible, onClose })
      )
    );
  act(() => render(true));
  expect(
    container.querySelector('[data-testid="spotlight-shell"]')
  ).not.toBeNull();
  expect(container.querySelector('[data-icon="chevron-left"]')).not.toBeNull();
  const submit = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="import-session-submit"]'
    )!;
  expect(submit().disabled).toBe(true);
  act(() => input.onChange("invalid link"));
  act(() => submit().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "cloud.share.importInvalidInput"
  );
  expect(store.get(org2CloudPendingShareAtom)).toBeNull();
  act(() => input.onChange("a".repeat(64)));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  act(() => submit().click());
  expect(store.get(org2CloudPendingShareAtom)?.shareToken).toBe("a".repeat(64));
  expect(onClose).toHaveBeenCalledOnce();
  expect(submit().disabled).toBe(true);
  act(() => render(false));
  expect(container.childElementCount).toBe(0);
  act(() => root.unmount());
  container.remove();
});

it("embeds without another shell and uses the card label", () => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const onClose = vi.fn();
  const onGoBack = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        Provider,
        {},
        createElement(ImportSharedSessionDialog, {
          visible: true,
          asBody: true,
          onClose,
          onGoBack,
        })
      )
    )
  );
  expect(container.querySelector('[data-testid="spotlight-shell"]')).toBeNull();
  expect(
    container.querySelector('[role="dialog"]')?.getAttribute("aria-label")
  ).toBe("cloud.share.importEntry");
  act(() =>
    container
      .querySelector('[data-icon="chevron-left"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }))
  );
  expect(onGoBack).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  act(() => root.unmount());
});
