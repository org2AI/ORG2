// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CUSTOMIZABLE_SHORTCUT_IDS,
  defaultBindings,
} from "@src/config/keyboard/shortcutBindings";

import { codeNavigationExtension } from "./codeNavigation";

const mocks = vi.hoisted(() => ({
  goToDefinition: vi.fn(),
  findReferences: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
}));

vi.mock("@src/services/navigation/CodeNavigationService", () => ({
  CodeNavigationService: {
    goToDefinition: mocks.goToDefinition,
    findReferences: mocks.findReferences,
    goBack: mocks.goBack,
    goForward: mocks.goForward,
  },
}));

const NAVIGATION_SHORTCUTS = [
  ["go_to_definition", "goToDefinition"],
  ["find_references", "findReferences"],
  ["go_back", "goBack"],
  ["go_forward", "goForward"],
] as const;

let view: EditorView;

function press(shortcutId: string): boolean {
  // Resolved for whatever platform matchesShortcut will compare against.
  const binding = defaultBindings(shortcutId)[0];
  if (!binding) throw new Error(`No binding for ${shortcutId}`);
  const event = new KeyboardEvent("keydown", {
    key: binding.key,
    ctrlKey: binding.ctrl,
    metaKey: binding.meta,
    altKey: binding.alt,
    shiftKey: binding.shift,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("codeNavigationExtension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [, command] of NAVIGATION_SHORTCUTS) {
      mocks[command].mockResolvedValue({ ok: true, message: "" });
    }
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "const a = 1;\n",
        extensions: [codeNavigationExtension()],
      }),
    });
  });

  afterEach(() => view.destroy());

  // The defect this guards: these four shortcuts were listed in
  // EDITOR_SHORTCUTS and shown in Settings with no dispatcher behind them, so
  // pressing them did nothing at all.
  it.each(NAVIGATION_SHORTCUTS)("binds %s", async (shortcutId, command) => {
    expect(press(shortcutId)).toBe(true);

    await vi.waitFor(() => expect(mocks[command]).toHaveBeenCalledTimes(1));
  });

  it.each(NAVIGATION_SHORTCUTS)(
    "%s is customizable now that it has an owning dispatcher",
    (shortcutId) => {
      expect(CUSTOMIZABLE_SHORTCUT_IDS.has(shortcutId)).toBe(true);
    }
  );

  it("leaves unrelated keys to the editor", () => {
    const event = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    for (const [, command] of NAVIGATION_SHORTCUTS) {
      expect(mocks[command]).not.toHaveBeenCalled();
    }
  });
});
