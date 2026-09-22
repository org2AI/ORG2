// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type UseComposerSectionsOptions,
  useComposerSections,
} from "../useComposerSections";

type Sections = ReturnType<typeof useComposerSections>;

describe("useComposerSections primary cards", () => {
  let container: HTMLDivElement;
  let root: Root;
  const latestRef: { current: Sections | null } = { current: null };
  const env = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  function Probe(props: UseComposerSectionsOptions) {
    const sections = useComposerSections(props);
    useEffect(() => {
      latestRef.current = sections;
    });
    return null;
  }

  function render(props: Partial<UseComposerSectionsOptions>) {
    act(() =>
      root.render(createElement(Probe, { onFilesExpand: () => {}, ...props }))
    );
  }

  beforeEach(() => {
    env.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    root = createRoot(container);
    latestRef.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    Reflect.deleteProperty(env, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("keeps new pending cards collapsed to their pill until clicked", () => {
    render({ hasQuestion: false, hasPermission: false, hasPlan: false });
    render({ hasQuestion: true, hasPermission: true, hasPlan: true });

    expect(latestRef.current?.questionCollapsed).toBe(true);
    expect(latestRef.current?.permissionCollapsed).toBe(true);
    expect(latestRef.current?.planCollapsed).toBe(true);
    expect(
      latestRef.current?.inlineSections.map((section) => section.key)
    ).toEqual(["question", "permission", "plan"]);

    const questionPill = latestRef.current?.inlineSections.find(
      (section) => section.key === "question"
    );
    act(() => questionPill?.onExpand());
    expect(latestRef.current?.questionCollapsed).toBe(false);
  });

  it("collapses again when the next pending item arrives", () => {
    render({ hasQuestion: true });
    act(() =>
      latestRef.current?.inlineSections
        .find((section) => section.key === "question")
        ?.onExpand()
    );
    expect(latestRef.current?.questionCollapsed).toBe(false);

    render({ hasQuestion: false });
    render({ hasQuestion: true });
    expect(latestRef.current?.questionCollapsed).toBe(true);
  });
});
