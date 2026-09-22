// @vitest-environment jsdom
import {
  ensureSyntaxTree,
  highlightingFor,
  syntaxTree,
} from "@codemirror/language";
import { getOriginalDoc } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as themes from "@src/features/CodeMirror/config/themeConfig";

import type { TranscriptItem } from "../../lib/transcriptReducer";
import {
  MobileRemotePlatformProvider,
  type MobileRemotePlatformProviderProps,
} from "../../platform/MobileRemotePlatformContext";
import { createBrowserMobileRemotePlatform } from "../../platform/browser";
import MobileFileViewer from "./MobileFileViewer";
import { MobileToolDetailModal } from "./MobileToolDetailModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const file = {
  id: "read-file",
  kind: "tool",
  text: "read_file",
  toolStatus: "completed",
  toolData: {
    kind: "file",
    filePath: "src/example.ts",
    fileName: "example.ts",
    language: "typescript",
    startLine: 7,
    content: "const value = '<safe>';\nconsole.log(value);",
    lineCount: 2,
  },
} satisfies TranscriptItem;
let root: Root;
let host: HTMLDivElement;
let platform: ReturnType<typeof createBrowserMobileRemotePlatform>;
const write = vi.fn<(text: string) => Promise<void>>();
const openDesktop = vi.fn<() => Promise<void>>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  platform = {
    ...createBrowserMobileRemotePlatform(),
    writeClipboardText: write,
  };
  write.mockReset().mockResolvedValue(undefined);
  openDesktop.mockReset().mockResolvedValue(undefined);
  // jsdom has no text geometry; the real editor still mounts, updates and destroys.
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, "getClientRects");
});

async function render(
  item: TranscriptItem = file,
  visible = true,
  canOpenDesktop = true
) {
  await act(async () =>
    root.render(
      React.createElement(
        MobileRemotePlatformProvider,
        { platform } as MobileRemotePlatformProviderProps,
        React.createElement(MobileToolDetailModal, {
          item,
          open: visible,
          onClose: vi.fn(),
          onOpenFile: canOpenDesktop ? openDesktop : undefined,
        })
      )
    )
  );
}
async function editor() {
  await act(async () => {
    await import("./MobileReadonlyEditor");
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector(".cm-content")).not.toBeNull();
  });
  return EditorView.findFromDOM(document.querySelector(".cm-content")!)!;
}
async function click(selector: string) {
  await act(async () =>
    (document.querySelector(selector) as HTMLButtonElement).click()
  );
}

describe("Mobile document viewing lifecycle", () => {
  it("revokes Desktop actions without removing the local document and ignores the old response", async () => {
    let finish!: () => void;
    openDesktop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render();
    const view = await editor();
    await click("[data-mobile-open-file]");
    await render(file, true, false);
    expect(document.querySelector("[data-mobile-open-file]")).toBeNull();
    expect(await editor()).toBe(view);
    await render(file, true, true);
    await act(async () => finish());
    expect(document.querySelector("[data-mobile-open-file]")?.textContent).toBe(
      "fileViewer.openDesktop"
    );
    expect(await editor()).toBe(view);
    expect(openDesktop).toHaveBeenCalledTimes(1);
  });

  it("single-flights rapid Desktop clicks and supports failure retry without remounting the editor", async () => {
    let reject!: (reason: Error) => void;
    openDesktop.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        })
    );
    await render();
    const view = await editor();
    const button = document.querySelector<HTMLButtonElement>(
      "[data-mobile-open-file]"
    )!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(openDesktop).toHaveBeenCalledTimes(1);
    expect(await editor()).toBe(view);
    await act(async () => reject(new Error("Desktop offline")));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "transcript.tools.openFileFailed"
    );
    await click("[data-mobile-open-file]");
    expect(openDesktop).toHaveBeenCalledTimes(2);
    expect(button.textContent).toBe("transcript.tools.fileOpenRequested");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(await editor()).toBe(view);
  });

  it("disposes the closed preview and ignores its response after reopening", async () => {
    let finish!: () => void;
    openDesktop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render();
    const oldEditor = await editor();
    const destroy = vi.spyOn(oldEditor, "destroy");
    await click("[data-mobile-open-file]");
    await render(file, false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
    await render();
    expect(await editor()).not.toBe(oldEditor);
    await act(async () => finish());
    expect(document.querySelector("[data-mobile-open-file]")?.textContent).toBe(
      "fileViewer.openDesktop"
    );
    await click("[data-mobile-open-file]");
    expect(openDesktop).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[data-mobile-open-file]")?.textContent).toBe(
      "transcript.tools.fileOpenRequested"
    );
  });

  it("isolates a replaced tool even when the file path and target index match", async () => {
    let fail!: (reason: Error) => void;
    openDesktop.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        })
    );
    await render();
    await click("[data-mobile-open-file]");
    await render({ ...file, id: "another-tool" });
    await act(async () => fail(new Error("Old request failed")));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector("[data-mobile-open-file]")?.textContent).toBe(
      "fileViewer.openDesktop"
    );
    await click("[data-mobile-open-file]");
    expect(openDesktop).toHaveBeenCalledTimes(2);
  });

  it("resets the Desktop outcome when a target is replaced at the same index", async () => {
    await render();
    await click("[data-mobile-open-file]");
    expect(document.querySelector("[data-mobile-open-file]")?.textContent).toBe(
      "transcript.tools.fileOpenRequested"
    );
    await render({
      ...file,
      toolData: {
        ...file.toolData,
        filePath: "src/other.ts",
        fileName: "other.ts",
      },
    });
    expect(
      document.querySelector('[data-mobile-open-file="src/other.ts"]')
        ?.textContent
    ).toBe("fileViewer.openDesktop");
    expect(openDesktop).toHaveBeenCalledTimes(1);
  });

  function edit(oldContent: string, newContent: string): TranscriptItem {
    return {
      ...file,
      toolData: {
        kind: "edit",
        filePath: "src/example.ts",
        fileName: "example.ts",
        language: "typescript",
        oldContent,
        newContent,
        newStartLine: 7,
        isDeleted: newContent === "",
        applyPatchSegments: [],
      },
    };
  }

  it("uses the actual merge engine with language tokens and added/deleted backgrounds, without write controls", async () => {
    const original = 'const answer = "before";';
    const modified = 'const answer = "after";';
    await render(edit(original, modified));
    const view = await editor();
    ensureSyntaxTree(view.state, view.state.doc.length, 100);
    expect(getOriginalDoc(view.state).toString()).toBe(original);
    expect(view.state.doc.toString()).toBe(modified);
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
    const added = view.contentDOM.querySelector(".cm-changedLine");
    const removed = view.contentDOM.querySelector(".cm-deletedLine");
    expect(added?.textContent).toBe(modified);
    expect(removed?.textContent).toBe(original);
    for (const line of [added, removed]) {
      const spans = [...line!.querySelectorAll("span")];
      const keyword = spans.find((span) => span.textContent === "const");
      const string = spans.find(
        (span) =>
          span.textContent?.includes('"') &&
          span.className !== keyword?.className
      );
      expect(keyword?.className).toBeTruthy();
      expect(string?.className).toBeTruthy();
      expect(keyword?.className).not.toBe(string?.className);
    }
    expect(view.dom.querySelector(".cm-mergeButtons")).toBeNull();
    const copy = [...document.querySelectorAll("button")].find(
      (button) =>
        button.getAttribute("aria-label") === "fileViewer.copyModified"
    )!;
    await act(async () => copy.click());
    expect(write).toHaveBeenCalledWith(modified);
    const wrap = document.querySelector(
      'button[aria-pressed="true"]'
    ) as HTMLButtonElement;
    await act(async () => wrap.click());
    expect(await editor()).toBe(view);
    expect(getOriginalDoc(view.state).toString()).toBe(original);
    const destroy = vi.spyOn(view, "destroy");
    await render(edit(original, modified), false);
    expect(destroy).toHaveBeenCalledOnce();
    expect(document.querySelector(".cm-editor")).toBeNull();
    expect(openDesktop).not.toHaveBeenCalled();
  });

  it("handles additions, full deletions and same-file snapshot replacement without stale original text", async () => {
    await render(edit("", "const added = true;"));
    const first = await editor();
    expect(
      first.contentDOM.querySelector(".cm-changedLine")?.textContent
    ).toContain("const added");
    const destroy = vi.spyOn(first, "destroy");
    await render(edit("const deleted = true;", ""));
    const second = await editor();
    expect(destroy).toHaveBeenCalledOnce();
    expect(getOriginalDoc(second.state).toString()).toBe(
      "const deleted = true;"
    );
    expect(
      second.contentDOM.querySelector(".cm-deletedLine")?.textContent
    ).toContain("const deleted");
    expect(second.state.doc.toString()).toBe("");
    expect(document.body.textContent).not.toContain("fileViewer.empty");
    await render(edit("const deleted = true;", "const modified = true;"));
    expect(await editor()).toBe(second);
    expect(second.state.doc.toString()).toBe("const modified = true;");
    await render(edit("const same = true;", "const same = true;"));
    expect(
      (await editor()).contentDOM.querySelector(".cm-changedLine")
    ).toBeNull();
  });

  it("does not diff independently truncated snapshots; keeps and copies the exact patch", async () => {
    const item = edit("const before = 1;\n…", "const after = 2;\n…");
    if (item.toolData?.kind !== "edit")
      throw new Error("Expected edit fixture");
    const patch = "@@ -1 +1 @@\n-const before = 1;\n+const after = 2;\n…";
    await render({
      ...item,
      toolDataTruncated: true,
      toolData: { ...item.toolData!, diff: patch },
    });
    expect((await editor()).state.doc.toString()).toBe(patch);
    expect(document.querySelector(".cm-changedLine")).toBeNull();
    expect(document.body.textContent).toContain("fileViewer.patchFallback");
    const copy = [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "fileViewer.copyPatch"
    )!;
    await act(async () => copy.click());
    expect(write).toHaveBeenCalledWith(patch);
  });
  it("opens the actual read-only editor locally, preserves offset and toggles wrap without remounting", async () => {
    await render();
    const view = await editor();
    expect(
      document.querySelector('[role="dialog"]')?.getAttribute("aria-label")
    ).toBe("example.ts");
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(view.state.doc.toString()).toBe(
      "const value = '<safe>';\nconsole.log(value);"
    );
    expect(document.querySelector(".cm-lineNumbers")?.textContent).toContain(
      "7"
    );
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    expect(openDesktop).not.toHaveBeenCalled();
    await click('button[aria-pressed="true"]');
    expect(await editor()).toBe(view);
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
    await click('[data-mobile-open-file="src/example.ts"]');
    expect(openDesktop).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/home/test/project/src/example.ts", "… / project / src"],
    ["C:\\work\\project\\src\\example.ts", "… / project / src"],
    ["src/example.ts", "src"],
    ["example.ts", "fileViewer.fileLocation"],
  ])(
    "keeps %s exact while presenting a compact, expandable file identity",
    async (filePath, directory) => {
      const item = { ...file, toolData: { ...file.toolData!, filePath } };
      await render(item);
      const view = await editor();
      const details = document.querySelector(
        "details.mobile-file-identity"
      ) as HTMLDetailsElement;
      expect(
        document.querySelector(
          ".mobile-tool-preview.mobile-tool-preview--file.modal-fullscreen"
        )
      ).not.toBeNull();
      const summary = details.querySelector("summary")!;
      expect(
        document.querySelector('[role="dialog"]')?.getAttribute("aria-label")
      ).toBe("example.ts");
      expect(
        document.querySelector("[data-mobile-file-directory]")?.textContent
      ).toBe(directory);
      expect(details.querySelector("img")?.getAttribute("aria-hidden")).toBe(
        "true"
      );
      expect(
        details.querySelector("[data-mobile-file-full-path]")?.textContent
      ).toBe(filePath);
      expect(
        document
          .querySelector(".mobile-file-viewer [title]")
          ?.getAttribute("title")
      ).not.toBe(filePath);
      expect(details.open).toBe(false);
      expect(summary.tabIndex).toBe(0);
      await act(async () => summary.click());
      expect(details.open).toBe(true);
      expect(await editor()).toBe(view);
      expect(openDesktop).not.toHaveBeenCalled();
      await click("[data-mobile-open-file]");
      expect(openDesktop).toHaveBeenCalledWith(
        expect.objectContaining({ filePath })
      );
      await render({
        ...file,
        toolData: {
          ...file.toolData!,
          filePath: "src/next.ts",
          fileName: "next.ts",
        },
      });
      expect(
        (
          document.querySelector(
            "details.mobile-file-identity"
          ) as HTMLDetailsElement
        ).open
      ).toBe(false);
      expect(
        document.querySelector('[role="dialog"]')?.getAttribute("aria-label")
      ).toBe("next.ts");
    }
  );

  it("copies the exact snapshot, recovers from clipboard errors and destroys the editor on close", async () => {
    await render();
    const view = await editor();
    const destroy = vi.spyOn(view, "destroy");
    write.mockRejectedValueOnce(new Error("denied"));
    const copy = [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "actions.copy"
    )!;
    await act(async () => copy.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "status.copyFailed"
    );
    await act(async () => copy.click());
    expect(write).toHaveBeenLastCalledWith(view.state.doc.toString());
    expect(copy.getAttribute("aria-label")).toBe("status.copied");
    expect(copy.textContent).toBe("actions.copy");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "status.copied"
    );
    await render(file, false);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".cm-editor")).toBeNull();
    await render();
    expect(await editor()).not.toBe(view);
  });

  it("keeps labeled controls accessible during copying, suppresses repeat taps, and ignores results for a replaced file", async () => {
    let finish!: () => void;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await render();
    const view = await editor();
    const copy = document.querySelector(
      'button[aria-label="actions.copy"]'
    ) as HTMLButtonElement;
    const wrap = document.querySelector(
      'button[aria-label="fileViewer.wrap"]'
    ) as HTMLButtonElement;
    const toolbar = document.querySelector(
      '[role="toolbar"][aria-label="fileViewer.actions"]'
    );
    expect(toolbar).not.toBeNull();
    expect([...toolbar!.querySelectorAll("button")]).toEqual([wrap, copy]);
    expect(copy.textContent).toBe("actions.copy");
    expect(wrap.textContent).toBe("fileViewer.wrap");
    for (const button of [copy, wrap]) {
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(button.classList.contains("min-h-11")).toBe(true);
      expect(button.title).toBe(button.getAttribute("aria-label"));
    }
    expect(wrap.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      copy.click();
      copy.click();
    });
    expect(write).toHaveBeenCalledOnce();
    expect(copy.disabled).toBe(true);
    expect(copy.getAttribute("aria-busy")).toBe("true");
    await act(async () => wrap.click());
    expect(wrap.getAttribute("aria-pressed")).toBe("false");
    expect(await editor()).toBe(view);
    await render({
      ...file,
      toolData: {
        ...file.toolData!,
        filePath: "src/next.ts",
        fileName: "next.ts",
        content: "const next = 2;",
      },
    });
    await act(async () => finish());
    const nextCopy = document.querySelector(
      'button[aria-label="actions.copy"]'
    ) as HTMLButtonElement;
    expect(nextCopy.disabled).toBe(false);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("");
    await act(async () => nextCopy.click());
    expect(write).toHaveBeenLastCalledWith("const next = 2;");
    expect(nextCopy.getAttribute("aria-label")).toBe("status.copied");
    expect(openDesktop).not.toHaveBeenCalled();
  });

  it("collapses patch and truncation notices into one compact summary without losing the explanation", async () => {
    const item = edit("before", "after");
    if (item.toolData?.kind !== "edit")
      throw new Error("Expected edit fixture");
    await render({
      ...item,
      toolDataTruncated: true,
      toolData: {
        ...item.toolData,
        diff: "@@ -1 +1 @@\n-before\n+after",
      },
    });
    await editor();
    const summary = document.querySelector("[aria-describedby]")!;
    expect(summary.textContent).toContain("fileViewer.patch");
    expect(summary.textContent).toContain("fileViewer.partial");
    expect(
      summary.querySelector("[data-mobile-file-partial]")?.textContent
    ).toBe("fileViewer.partial");
    const explanation = document.getElementById(
      summary.getAttribute("aria-describedby")!
    )!;
    expect(explanation.classList.contains("sr-only")).toBe(true);
    expect(explanation.textContent).toContain("fileViewer.patchFallback");
    expect(explanation.textContent).toContain("transcript.tools.truncated");
    expect(summary.getAttribute("title")).toBe(explanation.textContent);
    expect(document.querySelector(".mobile-file-viewer p")).toBeNull();
    await render(edit("before", "after"));
    expect(document.body.textContent).not.toContain("fileViewer.partial");
    expect(document.body.textContent).not.toContain("fileViewer.patchFallback");
    expect(document.body.textContent).toContain("fileViewer.diff");
  });

  it.each(["", "  \n\t"])(
    "renders exact empty/whitespace content %j",
    async (content) => {
      await render({ ...file, toolData: { ...file.toolData!, content } });
      expect((await editor()).state.doc.toString()).toBe(content);
      expect(document.body.textContent).not.toContain("fileViewer.unavailable");
      expect(document.body.textContent?.includes("fileViewer.empty")).toBe(
        content === ""
      );
    }
  );

  it("keeps missing snapshot distinct from empty and retains the truncation notice", async () => {
    await render({
      ...file,
      toolDataTruncated: true,
      toolData: { ...file.toolData!, content: undefined },
    });
    expect(document.querySelector(".cm-editor")).toBeNull();
    expect(document.body.textContent).toContain("fileViewer.unavailable");
    expect(document.body.textContent).toContain("transcript.tools.truncated");
    expect(document.body.textContent).toContain("fileViewer.partial");
    for (const label of ["actions.copy", "fileViewer.wrap"]) {
      const button = document.querySelector(
        `button[aria-label="${label}"]`
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe(label);
    }
  });

  it("switches files locally and ignores a stale Desktop response", async () => {
    const item: TranscriptItem = {
      ...file,
      toolData: {
        kind: "edit",
        filePath: "a.ts",
        fileName: "a.ts",
        language: "typescript",
        isDeleted: false,
        applyPatchSegments: ["a", "b"].map((name) => ({
          filePath: `${name}.ts`,
          fileName: `${name}.ts`,
          language: "typescript",
          isDeleted: false,
          oldContent: "",
          newContent: `const ${name} = 1;`,
          applyPatchSegments: [],
        })),
      },
    };
    let resolve!: () => void;
    openDesktop.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    await render(item);
    const first = await editor();
    const destroy = vi.spyOn(first, "destroy");
    await click('[data-mobile-open-file="a.ts"]');
    await click('[data-mobile-file-target="b.ts"]');
    expect((await editor()).state.doc.toString()).toBe("const b = 1;");
    expect(destroy).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    expect(
      document.querySelector('[data-mobile-open-file="b.ts"]')?.textContent
    ).toBe("fileViewer.openDesktop");
    expect(openDesktop).toHaveBeenCalledTimes(1);
    await render(item, false);
    await render(item);
    expect(
      document
        .querySelector('[data-mobile-file-target="a.ts"]')
        ?.getAttribute("aria-selected")
    ).toBe("true");
    expect((await editor()).state.doc.toString()).toBe("const a = 1;");
    expect(openDesktop).toHaveBeenCalledTimes(1);
  });

  it("keeps content readable if an editor render fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(themes, "getCodeMirrorTheme").mockImplementation(() => {
      throw new Error("editor unavailable");
    });
    const target = {
      targetIndex: 0,
      fileName: "fallback.ts",
      filePath: "fallback.ts",
      content: "const fallback = true;",
    };
    await act(async () =>
      root.render(
        React.createElement(
          MobileRemotePlatformProvider,
          { platform } as MobileRemotePlatformProviderProps,
          React.createElement(MobileFileViewer, {
            target,
            targets: [target],
            onSelect: vi.fn(),
            truncated: false,
          })
        )
      )
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector("pre")?.textContent).toBe(target.content);
    });
    expect(host.textContent).toContain("fileViewer.plainTextFallback");
  });

  it("retains both exact source versions when the merge renderer fails, and recovers for the next file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const theme = vi
      .spyOn(themes, "getCodeMirrorTheme")
      .mockImplementation(() => {
        throw new Error("editor unavailable");
      });
    const before = '<img src="x" onerror="alert(1)">';
    const after = "";
    await render(edit(before, after));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "fileViewer.plainTextFallback"
      )
    );
    expect(
      [...document.querySelectorAll("pre")].map((node) => node.textContent)
    ).toEqual([before, after]);
    expect(document.querySelector("pre img")).toBeNull();
    theme.mockRestore();
    await render(file);
    expect((await editor()).state.doc.toString()).toBe(file.toolData.content);
    expect(document.body.textContent).not.toContain(
      "fileViewer.plainTextFallback"
    );
  });

  it("keeps one visible merge editor and releases it on every repeated open/close cycle", async () => {
    const item = edit("const before = false;", "const after = true;");
    for (let index = 0; index < 3; index++) {
      await render(item);
      const view = await editor();
      expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);
      const destroy = vi.spyOn(view, "destroy");
      await render(item, false);
      expect(destroy).toHaveBeenCalledOnce();
      expect(document.querySelectorAll(".cm-editor")).toHaveLength(0);
    }
    expect(openDesktop).not.toHaveBeenCalled();
  });

  it("renders a diff as a snapshot and keeps long documents bounded without discarding source", async () => {
    await render({
      ...file,
      toolData: {
        kind: "edit",
        filePath: "a.ts",
        fileName: "a.ts",
        language: "typescript",
        isDeleted: false,
        applyPatchSegments: [],
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    });
    expect((await editor()).state.doc.toString()).toContain("+new");
    expect(document.body.textContent).toContain("fileViewer.patch");
    const content = "const value = 1;\n".repeat(7_000);
    await render({ ...file, toolData: { ...file.toolData!, content } });
    const view = await editor();
    expect(view.state.doc.toString()).toBe(content);
    expect(syntaxTree(view.state).length).toBe(0);
    expect(view.contentDOM.querySelectorAll(".cm-line").length).toBeLessThan(
      7_000
    );
  });

  it("highlights actual added/deleted lines in a multi-file diff, including after wrap and file switches", async () => {
    const patch =
      "--- /dev/null\n+++ b/example.ts\n@@ -0,0 +1,2 @@\n+import { useEffect } from 'react';\n+const ready = true;\n-old value";
    const snapshot: TranscriptItem = {
      ...file,
      toolData: {
        kind: "edit",
        filePath: "example.ts",
        fileName: "example.ts",
        language: "typescript",
        isDeleted: false,
        applyPatchSegments: ["a", "b"].map((name) => ({
          filePath: `${name}.ts`,
          fileName: `${name}.ts`,
          language: "typescript",
          isDeleted: false,
          applyPatchSegments: [],
          diff: patch,
        })),
      },
    };
    await render(snapshot);
    async function expectDiffHighlight() {
      const view = await editor();
      ensureSyntaxTree(view.state, view.state.doc.length, 100);
      const inserted = highlightingFor(view.state, [tags.inserted]);
      const deleted = highlightingFor(view.state, [tags.deleted]);
      expect(inserted, "theme must define added-line styling").toBeTruthy();
      const added = [...view.contentDOM.querySelectorAll(".cm-line")].find(
        (line) => line.textContent?.startsWith("+import")
      );
      const removed = [...view.contentDOM.querySelectorAll(".cm-line")].find(
        (line) => line.textContent === "-old value"
      );
      expect(added?.querySelector("span")?.className).toContain(inserted);
      expect(removed?.querySelector("span")?.className).toContain(deleted);
      expect(view.state.doc.toString()).toBe(patch);
      return view;
    }
    const view = await expectDiffHighlight();
    const wrap = [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "fileViewer.wrap"
    )!;
    await act(async () => wrap.click());
    expect(await expectDiffHighlight()).toBe(view);
    await click('[data-mobile-file-target="b.ts"]');
    await expectDiffHighlight();
    expect(openDesktop).not.toHaveBeenCalled();
  });

  it("highlights every added Markdown line even when transport truncation selects the raw patch fallback", async () => {
    const patch = [
      "--- /dev/null",
      "+++ b/docs/mobile-search-recovery.md",
      "@@ -0,0 +1,112 @@",
      "+# Mobile Remote 会话搜索：恢复与请求生命周期",
      "+",
      "+日期：2026-09-08",
      "+",
      "+## 本轮范围",
      "+",
      "+在工作区已有的历史会话搜索功能上补齐失败恢复：明确的重试入口、翻页失败重试原游标、断线结束 loading。",
      "…",
    ].join("\n");
    await render({
      ...file,
      toolDataTruncated: true,
      toolData: {
        kind: "edit",
        filePath: "docs/mobile-search-recovery.md",
        fileName: "mobile-search-recovery.md",
        language: "markdown",
        oldContent: "",
        newContent: "# Mobile Remote\n…",
        diff: patch,
        isDeleted: false,
        applyPatchSegments: [],
      },
    });
    const view = await editor();
    ensureSyntaxTree(view.state, view.state.doc.length, 100);
    expect(view.state.doc.toString()).toBe(patch);
    expect(document.body.textContent).toContain("fileViewer.patchFallback");
    const inserted = highlightingFor(view.state, [tags.inserted]);
    expect(inserted).toBeTruthy();
    const addedLines = [...view.contentDOM.querySelectorAll(".cm-line")].filter(
      (line) => line.textContent?.startsWith("+")
    );
    expect(addedLines).toHaveLength(8);
    for (const line of addedLines) {
      expect(line.querySelector("span")?.className).toContain(inserted);
    }
    expect(openDesktop).not.toHaveBeenCalled();
  });
});
