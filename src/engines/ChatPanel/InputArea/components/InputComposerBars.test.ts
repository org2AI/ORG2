// @vitest-environment jsdom
import React, { act, createElement, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type ComposerBar from "@src/engines/ChatPanel/ComposerBar";

import { NormalComposerContent } from "./InputComposerBars";

const testState = vi.hoisted(() => ({
  composerBarProps: null as React.ComponentProps<typeof ComposerBar> | null,
  inputEditorProps: null as Record<string, unknown> | null,
  expansionEnabled: [] as boolean[],
  expansion: {
    expanded: false,
    showToggle: false,
    editorClassName: "",
    toggle: () => {},
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/engines/ChatPanel/ComposerBar", async () => {
  const ReactModule = await import("react");
  return {
    default: (props: React.ComponentProps<typeof ComposerBar>) => {
      testState.composerBarProps = props;
      return ReactModule.createElement(
        "div",
        { "data-testid": "composer-bar" },
        props.leftPrefix,
        props.editorSlot,
        props.pills,
        props.modelPill,
        props.submitButton
      );
    },
  };
});

vi.mock("@src/components/Voice", async () => {
  const ReactModule = await import("react");
  return {
    VoiceInputButton: (props: { appearance?: string }) =>
      ReactModule.createElement("span", {
        "data-testid": "voice-button",
        "data-appearance": props.appearance,
      }),
    VoiceRecordingBar: () =>
      ReactModule.createElement("span", {
        "data-testid": "voice-recording-bar",
      }),
  };
});

vi.mock("@src/components/ComposerInput/useComposerExpansion", () => ({
  useComposerExpansion: (_ref: unknown, enabled: boolean) => {
    testState.expansionEnabled.push(enabled);
    return testState.expansion;
  },
}));

vi.mock("@src/components/ComposerInput/ComposerExpandToggle", async () => {
  const ReactModule = await import("react");
  return {
    default: (props: { expanded: boolean }) =>
      ReactModule.createElement("span", {
        "data-testid": "expand-toggle",
        "data-expanded": String(props.expanded),
      }),
  };
});

vi.mock("./InputEditor", async () => {
  const ReactModule = await import("react");
  return {
    default: (props: Record<string, unknown>) => {
      testState.inputEditorProps = props;
      return ReactModule.createElement(
        "span",
        { "data-testid": "input-editor" },
        props.leadingContent as React.ReactNode
      );
    },
  };
});

vi.mock("./InputActions", async () => {
  const ReactModule = await import("react");
  return {
    default: () =>
      ReactModule.createElement("span", { "data-testid": "input-actions" }),
  };
});

vi.mock("./PromptPolishButton", async () => {
  const ReactModule = await import("react");
  return {
    default: () =>
      ReactModule.createElement("span", { "data-testid": "prompt-polish" }),
  };
});

vi.mock("./CiteCodePreview", () => ({ default: () => null }));
vi.mock("./ImageAttachmentPreview", () => ({ default: () => null }));
vi.mock("./ReplyInfoDisplay", () => ({ default: () => null }));

describe("NormalComposerContent contextual presentations", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    testState.composerBarProps = null;
    testState.inputEditorProps = null;
    testState.expansionEnabled = [];
    testState.expansion = {
      expanded: false,
      showToggle: false,
      editorClassName: "",
      toggle: () => {},
    };
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

  const renderComposer = (
    currentInputEmpty: boolean,
    overrides: Partial<React.ComponentProps<typeof NormalComposerContent>> = {}
  ) => {
    const props = {
      composerInputRef: createRef(),
      showContextMenu: false,
      contextMenuKeyboardHandlerRef: { current: null },
      showSlashMenu: false,
      slashCommandKeyboardHandlerRef: { current: null },
      onSlashCommand: vi.fn(),
      onSlashCommandClose: vi.fn(),
      onContentChange: vi.fn(),
      onAtMention: vi.fn(),
      onAtMentionClose: vi.fn(),
      onSubmit: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onAddContent: vi.fn(),
      isCiteCode: false,
      selectedCiteRange: null,
      citeFileName: "",
      onClearCiteCode: vi.fn(),
      replyInfo: { isReply: false },
      onClearReplyInfo: vi.fn(),
      modePill: null,
      modelPill: null,
      isHosted: false,
      canStopAgent: false,
      canResume: false,
      onInterrupt: vi.fn(async () => undefined),
      onResume: vi.fn(async () => undefined),
      isCursorIde: false,
      showVoiceUi: false,
      voice: {
        elapsedSeconds: 0,
        isRecording: false,
        liveTranscript: "",
        cancel: vi.fn(),
        stop: vi.fn(),
        start: vi.fn(),
        toggle: vi.fn(),
        isSupported: true,
      },
      isCompactRow: false,
      contextualPanel: true,
      inlineLeadingContent: createElement("span", null, "Stat"),
      currentInputEmpty,
      stopSuppressedForEmptyInput: false,
      isWpGeneWorking: false,
      isPendingCancel: false,
      isSessionTerminal: false,
      voiceFeatureEnabled: true,
      dropTargetId: "canvas-design",
      promptPolish: {
        status: "idle",
        isAvailable: false,
        isPolishing: false,
        isPolished: false,
        toggle: vi.fn(async () => undefined),
        reset: vi.fn(),
      },
      promptPolishDisabled: true,
      showAgentControls: true,
      showImageAttachments: false,
      ...overrides,
    } as React.ComponentProps<typeof NormalComposerContent>;

    act(() => root.render(createElement(NormalComposerContent, props)));
  };

  it("renders contextual input with the full-size editor and standard actions", () => {
    renderComposer(true);

    expect(testState.composerBarProps).toMatchObject({
      inlineLayout: false,
      showContextInfo: false,
    });
    expect(testState.inputEditorProps).toMatchObject({
      compact: false,
      leadingContent: expect.anything(),
    });
    expect(container.textContent).toContain("Stat");
    expect(
      container.querySelector("[data-testid='input-editor']")
    ).not.toBeNull();
    expect(
      container
        .querySelector("[data-testid='voice-button']")
        ?.getAttribute("data-appearance")
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='input-actions']")
    ).not.toBeNull();
    expect(container.querySelector("[data-testid='prompt-polish']")).toBeNull();
  });

  it("moves the ordinary composer into the compact row without dropping controls", () => {
    renderComposer(true, {
      isCompactRow: true,
      contextualPanel: false,
      inlineLeadingContent: undefined,
      modePill: createElement("span", null, "Build"),
      modelPill: createElement("span", null, "Opus 5"),
    });

    expect(testState.composerBarProps).toMatchObject({
      inlineLayout: true,
      showContextInfo: true,
    });
    expect(testState.inputEditorProps).toMatchObject({ compact: true });
    expect(testState.inputEditorProps?.leadingContent).toBeUndefined();
    expect(container.textContent).toContain("Build");
    expect(container.textContent).toContain("Opus 5");
    expect(
      container.querySelector("[data-testid='prompt-polish']")
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='voice-button']")
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='input-actions']")
    ).not.toBeNull();
  });

  it("keeps the contextual reference on the compact row's editor line", () => {
    renderComposer(true, { isCompactRow: true });

    expect(testState.composerBarProps).toMatchObject({
      inlineLayout: true,
      showContextInfo: false,
    });
    expect(testState.inputEditorProps).toMatchObject({
      compact: true,
      leadingContent: expect.anything(),
    });
    expect(
      container.querySelector("[data-testid='input-editor']")?.textContent
    ).toBe("Stat");
  });

  it("places the expand toggle immediately left of the microphone", () => {
    testState.expansion = {
      expanded: true,
      showToggle: true,
      editorClassName: "composer-input-expanded",
      toggle: () => {},
    };
    renderComposer(false, {
      contextualPanel: false,
      inlineLeadingContent: undefined,
      promptPolish: {
        status: "idle",
        isAvailable: true,
        isPolishing: false,
        isPolished: false,
        toggle: vi.fn(async () => undefined),
        reset: vi.fn(),
      },
    });

    const order = [
      ...container.querySelectorAll(
        "[data-testid='prompt-polish'], [data-testid='expand-toggle'], [data-testid='voice-button'], [data-testid='input-actions']"
      ),
    ].map((node) => node.getAttribute("data-testid"));
    expect(order).toEqual([
      "prompt-polish",
      "expand-toggle",
      "voice-button",
      "input-actions",
    ]);
    expect(testState.inputEditorProps).toMatchObject({
      editorClassName: "composer-input-expanded",
    });
    expect(testState.expansionEnabled.at(-1)).toBe(true);
  });

  it("pauses expansion for the compact row and while recording", () => {
    renderComposer(false, { isCompactRow: true });
    expect(testState.expansionEnabled.at(-1)).toBe(false);

    renderComposer(false, { showVoiceUi: true });
    expect(testState.expansionEnabled.at(-1)).toBe(false);
    expect(container.querySelector("[data-testid='expand-toggle']")).toBeNull();
  });

  it("keeps the standard microphone and send actions after typing", () => {
    renderComposer(false);

    expect(
      container.querySelector("[data-testid='voice-button']")
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='input-actions']")
    ).not.toBeNull();
  });

  it("keeps contextual controls in the full-size shared toolbar", () => {
    renderComposer(true, {
      contextualPanel: true,
      inlineLeadingContent: createElement("span", null, "H1"),
      modePill: createElement("span", null, "Auto"),
      modelPill: createElement("span", null, "GPT 5.6 Sol · Extra High"),
    });

    expect(testState.composerBarProps).toMatchObject({
      inlineLayout: false,
      showContextInfo: false,
    });
    expect(testState.inputEditorProps).toMatchObject({
      compact: false,
      leadingContent: expect.anything(),
    });
    expect(container.textContent).toContain("H1");
    expect(
      container.querySelector("[data-testid='input-editor']")?.textContent
    ).toBe("H1");
    expect(container.textContent).toContain("Auto");
    expect(container.textContent).toContain("GPT 5.6 Sol · Extra High");
    expect(
      container.querySelector("[data-testid='input-editor']")
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='voice-button']")
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='input-actions']")
    ).not.toBeNull();
    expect(container.querySelector("[data-testid='prompt-polish']")).toBeNull();
  });
});
