// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ComposerInput, {
  type ComposerInputRef,
} from "@src/components/ComposerInput";
import type { UploadedFile } from "@src/features/SessionCreator/types";
import {
  sessionCreatorDraftAtom,
  sessionCreatorDraftStoreAtom,
} from "@src/store/session/creatorDraftAtom";
import {
  type SmokeRoot,
  createSmokeRoot,
  settle,
} from "@src/test/reactSmokeHarness";

import { useDraftManagement } from "./useDraftManagement";

vi.mock(
  "@src/store/session",
  () => import("@src/store/session/creatorDraftAtom")
);
vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));
vi.mock("@src/store/skills/installedSkillsAtom", async () => {
  const { atom } = await import("jotai");
  return { installedSkillsAtom: atom([]) };
});

describe("useDraftManagement composer content ownership", () => {
  let root: SmokeRoot;
  let store: ReturnType<typeof createStore>;
  const submit = vi.fn();

  function Harness({ seed = "" }: { seed?: string }) {
    const composerInputRef = useRef<ComposerInputRef>(null);
    const [editorContent, setEditorContent] = useState("");
    const [sessionName, setSessionName] = useState("");
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
    useDraftManagement({
      composerInputRef,
      editorContent,
      setEditorContent,
      sessionName,
      setSessionName,
      uploadedFiles,
      setUploadedFiles,
      agentIconId: null,
      cliAgentType: "codex",
    });
    return createElement(
      "div",
      null,
      // eslint-disable-next-line react-hooks/refs -- createElement forwards this ref to the editor; it does not read ref.current during render
      createElement(ComposerInput, {
        ref: composerInputRef,
        initialContent: seed,
        onContentChange: setEditorContent,
      }),
      createElement(
        "button",
        {
          disabled: !editorContent.trim(),
          onClick: () => submit(editorContent),
        },
        "Send"
      )
    );
  }

  const mount = (seed = "") =>
    root.render(
      createElement(Provider, { store }, createElement(Harness, { seed }))
    );
  const sendButton = () => root.container.querySelector("button")!;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    submit.mockClear();
    store = createStore();
    root = createSmokeRoot();
  });

  afterEach(async () => {
    await root.unmount();
    vi.useRealTimers();
  });

  it("keeps editor-seeded text sendable when the active slot has no saved draft", async () => {
    const text = "你是什么模\n模型";
    await mount(text);
    expect(
      root.container.querySelector('[contenteditable="true"]')?.textContent
    ).toContain("你是什么模");
    expect(sendButton().disabled).toBe(false);
    act(() => sendButton().click());
    expect(submit).toHaveBeenCalledWith(text);

    await settle(500);
    const saved = store.get(sessionCreatorDraftAtom);
    expect(saved?.editorContent).toBe(text);
    expect(saved?.editorSnapshot?.parts).toEqual([
      { kind: "text", text: "你是什么模" },
      { kind: "newline" },
      { kind: "text", text: "模型" },
    ]);
  });

  it("keeps a blank composer disabled and does not persist an empty draft", async () => {
    await mount();
    expect(sendButton().disabled).toBe(true);
    act(() => sendButton().click());
    expect(submit).not.toHaveBeenCalled();
    await settle(1000);
    expect(store.get(sessionCreatorDraftAtom)).toBeNull();
  });

  it("restores the persisted text after remount and settles without idle writes", async () => {
    await mount("saved prompt");
    await settle(500);
    await root.unmount();
    root = createSmokeRoot();
    await mount();
    await settle(50);
    expect(sendButton().disabled).toBe(false);
    act(() => sendButton().click());
    expect(submit).toHaveBeenCalledWith("saved prompt");
    await settle(500);
    const settled = store.get(sessionCreatorDraftStoreAtom);
    await settle(5000);
    expect(store.get(sessionCreatorDraftStoreAtom)).toBe(settled);
  });

  it("cancels pending persistence when the composer unmounts", async () => {
    await mount("unsaved prompt");
    await root.unmount();
    const before = store.get(sessionCreatorDraftStoreAtom);
    await settle(1000);
    expect(store.get(sessionCreatorDraftStoreAtom)).toBe(before);
  });
});
