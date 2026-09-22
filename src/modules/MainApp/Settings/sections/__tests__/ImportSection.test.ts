// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import ImportSection from "../ImportSection";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@src/features/ExternalSessionSources/SourceScanningSettings", () => ({
  default: () => createElement("div", { "data-testid": "shared-scanning" }),
}));
vi.mock(
  "@src/features/ExternalSessionSources/SessionProvenanceHooksSettings",
  () => ({
    default: () => createElement("div", { "data-testid": "shared-hooks" }),
  })
);

describe("ImportSection", () => {
  const mounted: Array<{ node: HTMLDivElement; root: Root }> = [];

  afterEach(async () => {
    for (const { node, root } of mounted.splice(0)) {
      await act(async () => root.unmount());
      node.remove();
    }
  });

  async function render(activeTab?: string): Promise<HTMLDivElement> {
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    mounted.push({ node, root });
    await act(async () => {
      root.render(createElement(ImportSection, { activeTab }));
    });
    // Let the lazy tab body resolve and commit.
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    return node;
  }

  it("opens on the shared scanning settings", async () => {
    const node = await render();

    expect(node.querySelector('[data-testid="shared-scanning"]')).not.toBe(
      null
    );
    expect(node.querySelector('[data-testid="shared-hooks"]')).toBe(null);
  });

  it("renders the shared hook settings on the hooks tab", async () => {
    const node = await render("hooks");

    expect(node.querySelector('[data-testid="shared-hooks"]')).not.toBe(null);
    expect(node.querySelector('[data-testid="shared-scanning"]')).toBe(null);
  });
});
