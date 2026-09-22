// @vitest-environment jsdom
import { createElement } from "react";
import { expect, it, vi } from "vitest";

import { ACTION_ID } from "@src/scaffold/ActionSystem";
import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import { SpotlightNavigationFooterAction } from "./SpotlightNavigationFooterAction";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  actionDispatch: vi.fn().mockResolvedValue(undefined),
  error: vi.fn(),
  registered: false,
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: mocks.error }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/hooks/navigation/useAppNavigate", () => ({
  useAppNavigate: () => mocks.navigate,
}));
vi.mock("@src/scaffold/ActionSystem", async (load) => ({
  ...(await load<typeof import("@src/scaffold/ActionSystem")>()),
  useActionSystemOptional: () => ({
    isValidAction: () => mocks.registered,
    dispatch: mocks.actionDispatch,
  }),
}));

it.each([true, false])(
  "closes once and selects exactly one navigation path (registered=%s)",
  async (registered) => {
    mocks.registered = registered;
    mocks.navigate.mockClear();
    mocks.actionDispatch.mockClear();
    const close = vi.fn();
    const root = createSmokeRoot();
    try {
      await root.render(
        createElement(SpotlightNavigationFooterAction, {
          onClose: close,
          actionId: ACTION_ID.APP_GO_TO_INTEGRATIONS,
          labelKey: "Manage models",
          fallbackPath: "/models",
        })
      );
      await dispatch(() => root.container.querySelector("button")!.click());
      expect(close).toHaveBeenCalledOnce();
      if (registered) {
        expect(mocks.actionDispatch).toHaveBeenCalledExactlyOnceWith(
          ACTION_ID.APP_GO_TO_INTEGRATIONS,
          {},
          "user"
        );
        expect(mocks.navigate).not.toHaveBeenCalled();
        expect(close.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.actionDispatch.mock.invocationCallOrder[0]
        );
      } else {
        expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/models");
        expect(mocks.actionDispatch).not.toHaveBeenCalled();
      }
    } finally {
      await root.unmount();
    }
  }
);

it("handles rejected navigation without starting a second fallback action", async () => {
  const error = new Error("Dispatch failed");
  mocks.registered = true;
  mocks.navigate.mockClear();
  mocks.error.mockClear();
  mocks.actionDispatch.mockRejectedValueOnce(error);
  const root = createSmokeRoot();
  try {
    await root.render(
      createElement(SpotlightNavigationFooterAction, {
        onClose: vi.fn(),
        actionId: ACTION_ID.APP_GO_TO_INTEGRATIONS,
        labelKey: "Manage models",
        fallbackPath: "/models",
      })
    );
    await dispatch(() => root.container.querySelector("button")!.click());
    expect(mocks.error).toHaveBeenCalledWith(
      "Failed to dispatch Spotlight navigation",
      error
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  } finally {
    await root.unmount();
  }
});
