// @vitest-environment jsdom
import {
  type Ref,
  createElement,
  createRef,
  useImperativeHandle,
  useRef,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type SmokeRoot,
  createSmokeRoot,
  dispatch,
} from "@src/test/reactSmokeHarness";

import { useEditorExpansion } from "../useEditorExpansion";

type Expansion = ReturnType<typeof useEditorExpansion>;

interface HarnessProps {
  enabled?: boolean;
  compactEligible?: boolean;
}

const observers: ResizeObserverStub[] = [];
const handleContentChange = vi.fn<(text: string) => void>();
const expansionRef = createRef<Expansion>();
let inkWidth = 0;

class ResizeObserverStub {
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: () => void) {
    observers.push(this);
  }
}

function Harness({
  enabled = true,
  compactEligible = true,
  expansion,
}: HarnessProps & { expansion: Ref<Expansion> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const result = useEditorExpansion({
    enabled,
    compactEligible,
    containerRef,
    handleContentChange,
  });
  useImperativeHandle(expansion, () => result, [result]);
  return createElement(
    "div",
    // eslint-disable-next-line react-hooks/refs -- createElement is required because Vitest only includes `.test.ts`; this is a normal React ref prop.
    { ref: containerRef },
    createElement(
      "div",
      { "data-composer-menu-anchor": true },
      createElement(
        "div",
        { "data-editor-slot": "true" },
        createElement("div", { className: "composer-input-content" })
      )
    )
  );
}

describe("useEditorExpansion", () => {
  let root: SmokeRoot;

  const latest = () => expansionRef.current!;

  const content = () =>
    root.container.querySelector<HTMLElement>(".composer-input-content")!;

  const type = (text: string) =>
    dispatch(() => {
      content().textContent = text;
      latest().onEditorContentChange(text);
    });

  async function renderHarness(props: HarnessProps = {}) {
    await root.render(
      createElement(Harness, { ...props, expansion: expansionRef })
    );
    Object.defineProperty(
      root.container.querySelector("[data-editor-slot]"),
      "clientWidth",
      { configurable: true, get: () => 100 }
    );
  }

  beforeEach(() => {
    root = createSmokeRoot();
    observers.length = 0;
    inkWidth = 0;
    handleContentChange.mockClear();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(document, "createRange").mockImplementation(
      () =>
        ({
          selectNodeContents: vi.fn(),
          getBoundingClientRect: () => ({ width: inkWidth }),
        }) as unknown as Range
    );
  });

  afterEach(async () => {
    await root.unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("expands on a newline and collapses only once the document is cleared", async () => {
    await renderHarness();

    await type("first\nsecond");
    expect(latest().editorMultiline).toBe(true);

    await type("first");
    expect(latest().editorMultiline).toBe(true);

    await type("");
    expect(latest().editorMultiline).toBe(false);
    expect(handleContentChange.mock.calls).toEqual([
      ["first\nsecond"],
      ["first"],
      [""],
    ]);
  });

  it("keeps the stacked editor for a document reduced to a bare newline", async () => {
    await renderHarness();

    await type("first\nsecond");
    await type("\n");

    expect(latest().editorMultiline).toBe(true);
  });

  it("stops measuring the row once the editor has expanded", async () => {
    await renderHarness();
    inkWidth = 90;
    await type("a line that fills the row");
    expect(latest().editorMultiline).toBe(true);
    const measurements = vi.mocked(document.createRange).mock.calls.length;

    await type("a line that fills the row and keeps growing");
    await type("a line that fills the row and keeps growing further");

    expect(vi.mocked(document.createRange).mock.calls).toHaveLength(
      measurements
    );
    expect(latest().editorMultiline).toBe(true);
  });

  it("expands around an inline pill", async () => {
    await renderHarness();
    const pill = document.createElement("span");
    pill.setAttribute("data-composer-pill", "true");

    await dispatch(() => {
      content().appendChild(pill);
      latest().onEditorContentChange("notes.md");
    });

    expect(latest().editorMultiline).toBe(true);
  });

  it("expands once a single line fills most of the compact row", async () => {
    await renderHarness();

    inkWidth = 70;
    await type("short line");
    expect(latest().editorMultiline).toBe(false);

    inkWidth = 85;
    await type("a line that nearly fills the row");
    expect(latest().editorMultiline).toBe(true);
  });

  it("does not measure row fill while the compact row is unavailable", async () => {
    await renderHarness({ compactEligible: false });
    inkWidth = 95;

    await type("a long line beside an attachment");
    expect(latest().editorMultiline).toBe(false);
    expect(observers).toHaveLength(0);

    await type("still\nmultiline");
    expect(latest().editorMultiline).toBe(true);
  });

  it("re-measures on resize and disconnects once the editor expands", async () => {
    await renderHarness();
    inkWidth = 60;
    await type("short line");
    const observer = observers[observers.length - 1];
    expect(observer.observe).toHaveBeenCalledTimes(2);

    inkWidth = 90;
    await dispatch(() => observer.callback());

    expect(latest().editorMultiline).toBe(true);
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("checks existing content before paint when the preference turns on", async () => {
    await renderHarness({ enabled: false });

    await type("drafted\nwhile disabled");
    expect(latest().editorMultiline).toBe(false);

    await root.render(
      createElement(Harness, { enabled: true, expansion: expansionRef })
    );
    expect(latest().editorMultiline).toBe(true);
  });

  it("does not keep a stale stacked editor for a document cleared while disabled", async () => {
    await renderHarness();
    await type("first\nsecond");
    expect(latest().editorMultiline).toBe(true);

    await root.render(
      createElement(Harness, { enabled: false, expansion: expansionRef })
    );
    expect(latest().editorMultiline).toBe(false);
    await type("");

    await root.render(
      createElement(Harness, { enabled: true, expansion: expansionRef })
    );
    expect(latest().editorMultiline).toBe(false);
  });
});
