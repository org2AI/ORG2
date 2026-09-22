/**
 * @vitest-environment jsdom
 */
import React, { type RefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useSearchShortcut } from "../useSearchShortcut";

// Test files are `.ts`, so the markup is built with createElement and the refs
// are filled in from the mounted DOM rather than handed to React.
interface HarnessProps {
  inputRef: RefObject<HTMLInputElement | null>;
  enabled?: boolean;
  testId?: string;
}

function Harness({
  inputRef,
  enabled = true,
  testId = "search",
}: HarnessProps) {
  useSearchShortcut(inputRef, { enabled });

  return React.createElement(
    "div",
    null,
    React.createElement("input", {
      defaultValue: "gpt",
      "data-testid": testId,
    }),
    React.createElement("button", { type: "button", "data-testid": "outside" }),
    React.createElement("textarea", { "data-testid": "editor" })
  );
}

const roots: Array<ReturnType<typeof createSmokeRoot>> = [];

interface Mounted {
  input: HTMLInputElement;
  find: (testId: string) => HTMLElement;
  unmount: () => Promise<void>;
}

async function mount(
  options: { enabled?: boolean; testId?: string } = {}
): Promise<Mounted> {
  const root = createSmokeRoot();
  roots.push(root);

  const inputRef: RefObject<HTMLInputElement | null> = { current: null };
  const testId = options.testId ?? "search";

  await root.render(
    React.createElement(Harness, {
      inputRef,
      enabled: options.enabled,
      testId,
    })
  );

  const find = (id: string) =>
    root.container.querySelector<HTMLElement>(`[data-testid='${id}']`)!;

  inputRef.current = find(testId) as HTMLInputElement;

  // jsdom gives every element a zero-size box, so nothing would count as
  // visible; report the field as painted the way a real layout would.
  inputRef.current.getClientRects = (() => [
    { width: 100, height: 20 },
  ]) as unknown as HTMLInputElement["getClientRects"];

  return { input: inputRef.current, find, unmount: root.unmount };
}

// jsdom reports no `navigator.platform`, so the registry resolves the Windows
// binding for `list_search` — Ctrl+F.
function pressFind(target: Element) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
}

afterEach(async () => {
  while (roots.length > 0) await roots.pop()?.unmount();
});

describe("useSearchShortcut", () => {
  it("focuses the field and selects what is already typed", async () => {
    const { input, find } = await mount();
    expect(document.activeElement).not.toBe(input);

    pressFind(find("outside"));

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("gpt".length);
  });

  it("leaves the chord to whatever editable surface already has focus", async () => {
    const { input, find } = await mount();

    pressFind(find("editor"));

    expect(document.activeElement).not.toBe(input);
  });

  it("binds nothing while disabled", async () => {
    const { input, find } = await mount({ enabled: false });

    pressFind(find("outside"));

    expect(document.activeElement).not.toBe(input);
  });

  it("answers from the foreground field when several are mounted", async () => {
    // A settings page behind a panel, then the panel's own table: the panel
    // mounted last, so it is the one the user is looking at.
    const behind = await mount({ testId: "behind" });
    const front = await mount({ testId: "front" });

    pressFind(front.find("outside"));
    expect(document.activeElement).toBe(front.input);
    expect(document.activeElement).not.toBe(behind.input);

    // Once the panel closes, the page behind it answers again.
    await front.unmount();
    roots.pop();

    pressFind(behind.find("outside"));
    expect(document.activeElement).toBe(behind.input);
  });

  it("skips fields that are mounted but not painted", async () => {
    const hidden = await mount({ testId: "hidden" });
    const visible = await mount({ testId: "visible" });

    // The newest field is in a closed tab: it must not swallow the chord.
    visible.input.getClientRects =
      (() => []) as unknown as HTMLInputElement["getClientRects"];

    pressFind(hidden.find("outside"));

    expect(document.activeElement).toBe(hidden.input);
  });
});
