// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import UserMessageContent from "../UserMessageContent";

describe("UserMessageContent command references", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function renderMessage(text: string) {
    act(() => root.render(createElement(UserMessageContent, { text })));
  }

  it("keeps the Canvas command's composer face after it is sent", () => {
    renderMessage("canvas [skill:/canvas] 看看这个是啥");

    const pill = container.querySelector("[role='link'][title='/canvas']");
    expect(pill?.textContent).toContain("canvas");
    expect(container.textContent).toContain("看看这个是啥");
  });

  it("gives other commands the same skill pill the composer shows", () => {
    renderMessage("compact [skill:/compact] keep tests");

    const pill = container.querySelector("[role='link'][title='/compact']");
    expect(pill?.textContent).toContain("compact");
    expect(container.querySelector('[data-icon="toolbox"]')).not.toBeNull();
  });
});
