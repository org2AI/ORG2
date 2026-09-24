// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ComposerInput, {
  type ComposerInputRef,
} from "@src/components/ComposerInput";
import { useDraftManagement } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement";
import type { UploadedFile } from "@src/features/SessionCreator/types";
import { activeSessionIdAtom } from "@src/store/session";
import {
  saveDraft,
  sessionCreatorDraftAtom,
  sessionCreatorDraftStoreAtom,
} from "@src/store/session/creatorDraftAtom";
import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useNewCanvasDraft } from "./useNewCanvasDraft";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));
vi.mock("@src/store/skills/installedSkillsAtom", async () => {
  const { atom } = await import("jotai");
  return { installedSkillsAtom: atom([]) };
});

function Creator() {
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
    cliAgentType: null,
  });
  // eslint-disable-next-line react-hooks/refs -- forwards the editor ref
  return createElement(ComposerInput, {
    ref: composerInputRef,
    onContentChange: setEditorContent,
  });
}
function Launcher() {
  const create = useNewCanvasDraft();
  return createElement("button", { onClick: create }, "New Canvas");
}

describe("new Canvas draft journey", () => {
  let root: SmokeRoot;
  beforeEach(() => {
    localStorage.clear();
    mocks.navigate.mockClear();
    root = createSmokeRoot();
  });
  afterEach(async () => {
    await root.unmount();
  });

  it("does no work until clicked and keeps repeated creation isolated", async () => {
    const store = createStore();
    await root.render(
      createElement(Provider, { store }, createElement(Launcher))
    );
    const idle = store.get(sessionCreatorDraftStoreAtom);
    await root.render(
      createElement(Provider, { store }, createElement(Launcher))
    );
    expect(store.get(sessionCreatorDraftStoreAtom)).toBe(idle);
    expect(mocks.navigate).not.toHaveBeenCalled();
    act(() => root.container.querySelector("button")!.click());
    const first = store.get(sessionCreatorDraftAtom)!;
    act(() => root.container.querySelector("button")!.click());
    const second = store.get(sessionCreatorDraftAtom)!;
    expect(second.id).not.toBe(first.id);
    expect(
      Object.keys(store.get(sessionCreatorDraftStoreAtom).drafts)
    ).toHaveLength(2);
    expect(
      store.get(sessionCreatorDraftStoreAtom).drafts[first.id].editorSnapshot
    ).toEqual(first.editorSnapshot);
  });

  it("preserves the previous draft, navigates to a fresh draft and restores its Canvas pill", async () => {
    const store = createStore();
    const previous = saveDraft({
      sessionName: "existing",
      editorContent: "keep my text",
      uploadedFiles: [],
    });
    store.set(sessionCreatorDraftAtom, previous);
    store.set(activeSessionIdAtom, "codex-app:existing");
    await root.render(
      createElement(Provider, { store }, createElement(Launcher))
    );
    act(() => root.container.querySelector("button")!.click());
    const created = store.get(sessionCreatorDraftAtom)!;
    expect(created.id).not.toBe(previous.id);
    expect(created.editorContent).toBe("canvas [skill:/canvas] ");
    expect(
      store.get(sessionCreatorDraftStoreAtom).drafts[previous.id]
    ).toMatchObject({
      editorContent: "keep my text",
      sidebarVisible: true,
    });
    expect(store.get(activeSessionIdAtom)).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledOnce();
    await root.render(
      createElement(Provider, { store }, createElement(Creator))
    );
    expect(
      root.container.querySelector('[data-file-path="/canvas"]')
    ).not.toBeNull();
    const saved = JSON.parse(
      localStorage.getItem("orgii:sessionCreatorDrafts")!
    );
    expect(saved.drafts[created.id].editorSnapshot).toEqual(
      created.editorSnapshot
    );
    await root.unmount();
    root = createSmokeRoot();
    await root.render(
      createElement(Provider, { store }, createElement(Creator))
    );
    expect(
      root.container.querySelector('[data-file-path="/canvas"]')
    ).not.toBeNull();
  });
});
