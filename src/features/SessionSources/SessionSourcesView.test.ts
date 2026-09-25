// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { SessionSourcesView } from "./SessionSourcesView";

const navigation = vi.hoisted(() => ({
  openSource: vi.fn(),
  closeImagePreview: vi.fn(),
  imagePreview: null,
}));
vi.mock("./useSessionSourceNavigation", () => ({
  useSessionSourceNavigation: () => navigation,
}));
vi.mock("./SessionSourceThumbnail", () => ({
  SessionSourceThumbnail: () =>
    React.createElement("span", { "data-thumbnail": true }),
}));
vi.mock("./SessionSourceImagePreview", () => ({
  SessionSourceImagePreview: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;
const retry = vi.fn();
const sources: SessionSource[] = Array.from({ length: 65 }, (_, index) => ({
  kind: "image",
  key: `image:${index}`,
  ref: `/tmp/shot-${index}.png`,
  fileName: `shot-${index}.png`,
}));
async function render(
  props: Partial<React.ComponentProps<typeof SessionSourcesView>> = {},
  key = "session-a"
) {
  await act(async () => {
    root.render(
      React.createElement(SessionSourcesView, {
        key,
        sources,
        onRetry: retry,
        ...props,
      })
    );
  });
}
function click(text: string) {
  act(() =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes(text))!
      .click()
  );
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("SessionSourcesView", () => {
  it("bounds image reads, opens source rows and reveals further pages on request", async () => {
    await render();
    expect(container.querySelectorAll("[data-thumbnail]")).toHaveLength(30);
    click("shot-2.png");
    expect(navigation.openSource).toHaveBeenCalledWith(sources[2]);
    click("loadMoreSources");
    expect(container.querySelectorAll("[data-thumbnail]")).toHaveLength(60);
    await render({}, "session-b");
    expect(container.querySelectorAll("[data-thumbnail]")).toHaveLength(30);
  });
  it("shows sources directly without search or refresh chrome", async () => {
    await render();
    expect(container.querySelector("input")).toBeNull();
    expect(
      container.querySelector('[aria-label="common:actions.refresh"]')
    ).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(30);
  });
  it("renders and opens non-image resources with distinct assistant and tool provenance", async () => {
    const mixed: SessionSource[] = [
      {
        kind: "link",
        key: "pr",
        url: "https://github.com/org/repo/pull/42",
        label: "fix(chat): source navigation",
        origin: "assistant-reference",
        origins: ["assistant-reference", "provided-link"],
      },
      {
        kind: "file",
        key: "report",
        path: "/tmp/report.md",
        fileName: "report.md",
        title: "Implementation report",
        isDirectory: false,
        origin: "assistant-reference",
      },
      {
        kind: "file",
        key: "tool",
        path: "/tmp/data.csv",
        fileName: "data.csv",
        isDirectory: false,
        origin: "tool-result",
        toolName: "read_file",
      },
    ];
    await render({ sources: mixed });
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelectorAll("[data-thumbnail]")).toHaveLength(0);
    expect(container.textContent).toContain("sourceAssistantReference");
    expect(container.textContent).toContain("sourceLinkProvided");
    expect(container.textContent).toContain("sourceToolResultNamed");
    click("Implementation report");
    expect(navigation.openSource).toHaveBeenCalledWith(mixed[1]);
    click("fix(chat): source navigation");
    expect(navigation.openSource).toHaveBeenCalledWith(mixed[0]);
  });
  it("groups by type, preserves recency within each group and pages images independently", async () => {
    const link: SessionSource = {
      kind: "link",
      key: "link",
      url: "https://example.com",
      label: "Reference",
    };
    const tool: SessionSource = {
      kind: "tool-group",
      key: "tool",
      group: "exec",
      operations: [],
    };
    const file: SessionSource = {
      kind: "file",
      key: "file",
      path: "/tmp/report.md",
      fileName: "report.md",
      isDirectory: false,
    };
    await render({
      sources: [tool, sources[0], link, file, ...sources.slice(1)],
    });
    expect(
      [...container.querySelectorAll("[data-source-category]")].map((element) =>
        element.getAttribute("data-source-category")
      )
    ).toEqual(["image", "file", "link", "tool-group"]);
    const images = container.querySelector('[data-source-category="image"]')!;
    expect(images.querySelectorAll("li")).toHaveLength(30);
    expect(images.querySelector("li")?.textContent).toContain("shot-0.png");
    expect(
      container.querySelector('[data-source-category="link"]')?.textContent
    ).toContain("Reference");
    expect(
      container.querySelector('[data-source-category="file"]')?.textContent
    ).toContain("report.md");
    click("loadMoreSources");
    expect(images.querySelectorAll("li")).toHaveLength(60);
    await render({ sources: [link] }, "session-b");
    expect(container.querySelectorAll("[data-source-category]")).toHaveLength(
      1
    );
    expect(
      container.querySelector('[data-source-category="image"]')
    ).toBeNull();
  });
  it("preserves successful rows during failed refresh and offers retry", async () => {
    await render({ error: true });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "sourcesLoadFailed"
    );
    expect(container.querySelectorAll("li")).toHaveLength(30);
    click("actions.retry");
    expect(retry).toHaveBeenCalledOnce();
    await render({ loading: true });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(30);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("distinguishes loading, empty and unavailable lists", async () => {
    await render({ sources: [], loading: true });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "status.loading"
    );
    await render({ sources: [] });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "noSources"
    );
    await render({ sources: [], error: true });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "sourcesUnavailable"
    );
  });
});
