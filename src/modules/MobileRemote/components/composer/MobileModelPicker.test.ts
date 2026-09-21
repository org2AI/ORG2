// @vitest-environment jsdom
import React, { act, createElement } from "react";
import type { ComponentProps, ComponentType, PropsWithChildren } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as keyValidation from "@src/api/services/keyValidation";
import * as sharedLocalKeys from "@src/hooks/keyVault/sharedLocalKeyStore";
import { MobileRemotePlatformProvider } from "@src/modules/MobileRemote/platform";
import { createBrowserMobileRemotePlatform } from "@src/modules/MobileRemote/platform/browser";

import { MobileModelPicker } from "./MobileModelPicker";

vi.mock("@src/components/ModelIcon", () => ({
  default: () => React.createElement("svg", { "data-icon": "model" }),
}));

const dropdownTestState = vi.hoisted(() => ({ isOpen: false }));

vi.mock("@src/hooks/dropdown", () => ({
  useDropdownEngine: (options?: { open?: boolean }) => {
    if (options && "open" in options) {
      return {
        isPositioned: options.open,
        panelRef: { current: null },
        panelPosition: { top: 0, left: 0, maxHeight: 280 },
        keyboard: {
          getItemProps: () => ({}),
        },
      };
    }
    return {
      get isOpen() {
        return dropdownTestState.isOpen;
      },
      get isPositioned() {
        return dropdownTestState.isOpen;
      },
      panelRef: { current: null },
      panelPosition: { top: 0, left: 0, maxHeight: 280 },
      toggle: () => {
        dropdownTestState.isOpen = !dropdownTestState.isOpen;
      },
      close: () => {
        dropdownTestState.isOpen = false;
      },
      keyboard: {
        getItemProps: () => ({}),
      },
    };
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// Keep the actual model and KeyVault hooks. Spies observe the owning desktop
// resource boundaries so an accidentally mounted adapter cannot silently pass.
const subscribeLocalKeys = vi.spyOn(
  sharedLocalKeys,
  "subscribeSharedLocalKeys"
);
const listLocalKeys = vi.spyOn(keyValidation, "listKeys");
const saveLocalKey = vi.spyOn(keyValidation, "saveKey");
beforeEach(() => {
  subscribeLocalKeys.mockClear();
  listLocalKeys.mockClear();
  saveLocalKey.mockClear();
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  host?.remove();
  root = null;
  host = null;
  dropdownTestState.isOpen = false;
  expect(subscribeLocalKeys).not.toHaveBeenCalled();
  expect(listLocalKeys).not.toHaveBeenCalled();
  expect(saveLocalKey).not.toHaveBeenCalled();
});

// The dropdown portals through the platform port, so the unit test needs a
// mounted platform exactly like the app tree provides.
const testPlatform = createBrowserMobileRemotePlatform();

const TestMobileRemotePlatformProvider =
  MobileRemotePlatformProvider as ComponentType<
    PropsWithChildren<
      Omit<ComponentProps<typeof MobileRemotePlatformProvider>, "children">
    >
  >;

async function renderPicker(
  overrides: Partial<React.ComponentProps<typeof MobileModelPicker>> = {}
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(
        TestMobileRemotePlatformProvider,
        { platform: testPlatform },
        createElement(MobileModelPicker, {
          config: {
            sessionId: "session-a",
            model: "claude-sonnet-4-5",
            accountId: "acct-1",
            modelEditable: true,
          },
          options: [
            {
              id: "claude-sonnet-4-5",
              accountId: "acct-1",
              accountLabel: "Anthropic",
            },
            {
              id: "claude-opus-4-5",
              accountId: "acct-1",
              accountLabel: "Anthropic",
            },
            {
              id: "gpt-5.6-sol",
              accountId: "acct-1",
              accountLabel: "Anthropic",
            },
            {
              id: "gpt-5.6-sol-low",
              accountId: "acct-1",
              accountLabel: "Anthropic",
            },
            {
              id: "gpt-5.6-sol-medium",
              accountId: "acct-1",
              accountLabel: "Anthropic",
            },
            {
              id: "gpt-5.6-sol-high",
              accountId: "acct-1",
              accountLabel: "Anthropic",
            },
            {
              id: "gpt-5.6-sol-max",
              accountId: "acct-1",
              accountLabel: "Anthropic",
            },
          ],
          open: false,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onSelect: vi.fn(),
          ...overrides,
        })
      )
    );
  });
}

describe("MobileModelPicker", () => {
  it("uses only the remote account after scope replacement and repeated remounts", async () => {
    const select = vi.fn();
    await renderPicker({ onSelect: select });
    const nextProps: React.ComponentProps<typeof MobileModelPicker> = {
      config: {
        sessionId: "session-b",
        model: "gpt-5.6-sol-low",
        accountId: "remote-b",
        modelEditable: true,
      },
      options: ["low", "high"].map((level) => ({
        id: `gpt-5.6-sol-${level}`,
        accountId: "remote-b",
        accountLabel: "Remote B",
      })),
      open: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onSelect: select,
    };
    const renderNext = () =>
      root!.render(
        createElement(
          TestMobileRemotePlatformProvider,
          { platform: testPlatform },
          createElement(MobileModelPicker, nextProps)
        )
      );
    await act(async () => renderNext());
    expect(host!.textContent).toContain("GPT");
    expect(host!.textContent).not.toContain("Sonnet");
    await act(async () => {
      host!
        .querySelector<HTMLButtonElement>(
          "[data-testid=mobile-model-picker-pill]"
        )!
        .click();
      renderNext();
    });
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          "[data-testid=model-settings-effort]"
        )!
        .click()
    );
    const high = document.querySelector<HTMLButtonElement>(
      "[data-testid=model-settings-effort-high]"
    );
    expect(high).not.toBeNull();
    await act(async () => high!.click());
    expect(select).toHaveBeenCalledExactlyOnceWith({
      id: "gpt-5.6-sol-high",
      accountId: "remote-b",
      accountLabel: "Remote B",
    });
    // Publication into the desktop credential store cannot override remote props.
    await act(async () => sharedLocalKeys.publishSharedLocalKeys([]));
    expect(host!.textContent).toContain("GPT");
    for (let index = 0; index < 3; index++) {
      await act(async () => root!.render(null));
      await act(async () => renderNext());
    }
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("shows a catalog failure with retry while retaining the current model", async () => {
    const retry = vi.fn();
    await renderPicker({
      open: true,
      options: [],
      error: "catalog unavailable",
      onRetry: retry,
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "catalog unavailable"
    );
    const button = Array.from(document.querySelectorAll("button")).find(
      (item) => item.textContent === "transcript.retry"
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(retry).toHaveBeenCalledOnce();
    expect(host?.textContent).toContain("Sonnet");
  });

  it("keeps the shared settings trigger interactive while its catalog is loading", async () => {
    const activate = vi.fn();
    await renderPicker({ optionsLoading: true, onActivate: activate });
    const trigger = host!.querySelector(
      '[data-testid="mobile-model-picker-trigger"]'
    )!;
    expect(trigger.querySelector(".pointer-events-none")).toBeNull();
    const button = trigger.querySelector("button")!;
    await act(async () => button.focus());
    expect(activate).toHaveBeenCalled();
  });

  it("renders a desktop-style model pill with the formatted current model", async () => {
    await renderPicker();
    const trigger = host?.querySelector(
      "[data-testid=mobile-model-picker-trigger]"
    );
    expect(trigger?.textContent).toContain("Sonnet 4.5");
    expect(
      host?.querySelector("[data-testid=mobile-model-picker-pill]")
    ).not.toBeNull();
  });

  it("renders inline without outer padding when embedded", async () => {
    await renderPicker({ embedded: true });
    const trigger = host?.querySelector(
      "[data-testid=mobile-model-picker-trigger]"
    );
    const pill = host?.querySelector("[data-testid=mobile-model-picker-pill]");
    expect(trigger?.className).toContain("min-w-0");
    expect(trigger?.className).not.toContain("px-1");
    expect(pill?.className).not.toContain("pl-0");
    expect(pill?.className).toContain("px-3");
  });

  it("formats cursor-hosted grok ids instead of showing the raw slug", async () => {
    await renderPicker({
      config: {
        sessionId: "session-a",
        model: "cursor-grok-4.6-medium",
        accountId: "acct-1",
        modelEditable: true,
      },
      options: [
        {
          id: "cursor-grok-4.6-medium",
          accountId: "acct-1",
          accountLabel: "Cursor",
        },
        {
          id: "cursor-grok-4.6-high",
          accountId: "acct-1",
          accountLabel: "Cursor",
        },
      ],
    });
    const pill = host?.querySelector("[data-testid=mobile-model-picker-pill]");
    expect(pill?.textContent).toContain("Grok 4.6");
    expect(pill?.textContent).not.toContain("cursor-grok-4.6-medium");
  });

  it("lists collapsed base models in an anchored dropdown when open", async () => {
    await renderPicker({ open: true });
    expect(
      document.body.querySelector("[data-testid=mobile-model-picker-dropdown]")
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Opus 4.5");
    expect(document.body.textContent).toContain("Anthropic");
    expect(document.body.textContent).not.toContain("Max");
  });

  it("opens the compact model settings menu from the pill", async () => {
    await renderPicker({
      config: {
        sessionId: "session-a",
        model: "gpt-5.6-sol-max",
        accountId: "acct-1",
        modelEditable: true,
      },
    });
    const pill = host?.querySelector(
      "[data-testid=mobile-model-picker-pill]"
    ) as HTMLButtonElement | null;
    expect(pill).not.toBeNull();
    await act(async () => {
      pill?.click();
      root?.render(
        createElement(
          TestMobileRemotePlatformProvider,
          { platform: testPlatform },
          createElement(MobileModelPicker, {
            config: {
              sessionId: "session-a",
              model: "gpt-5.6-sol-max",
              accountId: "acct-1",
              modelEditable: true,
            },
            options: [
              {
                id: "claude-sonnet-4-5",
                accountId: "acct-1",
                accountLabel: "Anthropic",
              },
              {
                id: "claude-opus-4-5",
                accountId: "acct-1",
                accountLabel: "Anthropic",
              },
              {
                id: "gpt-5.6-sol",
                accountId: "acct-1",
                accountLabel: "Anthropic",
              },
              {
                id: "gpt-5.6-sol-low",
                accountId: "acct-1",
                accountLabel: "Anthropic",
              },
              {
                id: "gpt-5.6-sol-medium",
                accountId: "acct-1",
                accountLabel: "Anthropic",
              },
              {
                id: "gpt-5.6-sol-high",
                accountId: "acct-1",
                accountLabel: "Anthropic",
              },
              {
                id: "gpt-5.6-sol-max",
                accountId: "acct-1",
                accountLabel: "Anthropic",
              },
            ],
            open: false,
            onOpen: vi.fn(),
            onClose: vi.fn(),
            onSelect: vi.fn(),
          })
        )
      );
    });
    expect(
      document.body.querySelector("[data-testid=model-settings-model]")
    ).not.toBeNull();
    expect(
      document.body.querySelector("[data-testid=model-settings-effort]")
    ).not.toBeNull();
  });
});
