// @vitest-environment jsdom
import type { Extension } from "@codemirror/state";
import { StrictMode, act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLazyLanguageExtension } from "./useLazyLanguageExtension";

const mocks = vi.hoisted(() => ({ load: vi.fn(), sync: vi.fn() }));
vi.mock("../../shared/lazyLanguageExtensions", () => ({
  loadLanguageExtension: mocks.load,
  getLanguageExtensionSync: mocks.sync,
}));

let root: Root;
let container: HTMLDivElement;
let latest: Extension | null;
let pending: Array<{
  language: string;
  resolve: (value: Extension | null) => void;
}>;
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function Harness({ language }: { language?: string }) {
  const extension = useLazyLanguageExtension({ language });
  useEffect(() => {
    latest = extension;
  }, [extension]);
  return null;
}

function render(language?: string, strict = false) {
  act(() =>
    root.render(
      strict
        ? createElement(StrictMode, null, createElement(Harness, { language }))
        : createElement(Harness, { language })
    )
  );
}

beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  pending = [];
  latest = null;
  mocks.sync.mockReturnValue(null);
  mocks.load.mockImplementation(
    (language: string) =>
      new Promise<Extension | null>((resolve) =>
        pending.push({ language, resolve })
      )
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  vi.clearAllMocks();
});

describe("lazy language completion ownership", () => {
  it("ignores stale completion across A → B → A", async () => {
    render("python");
    render("rust");
    render("python");
    const stale: Extension = [];
    const current: Extension = [];
    await act(async () => pending[0].resolve(stale));
    expect(latest).toBeNull();
    await act(async () => pending[1].resolve(stale));
    expect(latest).toBeNull();
    await act(async () => pending[2].resolve(current));
    expect(latest).toBe(current);
  });

  it("survives StrictMode cleanup and replay", async () => {
    render("python", true);
    expect(pending).toHaveLength(2);
    await act(async () => pending[0].resolve([]));
    expect(latest).toBeNull();
    const current: Extension = [];
    await act(async () => pending[1].resolve(current));
    expect(latest).toBe(current);
  });

  it("does not reuse a late extension after switching to no language", async () => {
    render("python");
    render();
    await act(async () => pending[0].resolve([]));
    expect(latest).toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("returns synchronous highlighting without loading an async parser", () => {
    const synchronous: Extension = [];
    mocks.sync.mockReturnValue(synchronous);
    render("tsx");
    expect(latest).toBe(synchronous);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("drops completion after unmount", async () => {
    render("python");
    act(() => root.render(null));
    await act(async () => pending[0].resolve([]));
    expect(latest).toBeNull();
  });
});
