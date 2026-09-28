// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { serializeSubmissionSnapshot } from "@src/engines/ChatPanel/hooks/useInputArea/submissionSnapshot";

import { useEditorOperations } from "../useEditorOperations";
import { extractPlainText } from "../utils";

it("excludes newline caret anchors from submitted snapshots and restored drafts", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let editor!: ReturnType<typeof useEditorOperations>;
  function Probe() {
    const operations = useEditorOperations();
    useEffect(() => {
      editor = operations;
    });
    return createElement("div", {
      ref: operations.hostRef,
      contentEditable: true,
    });
  }
  try {
    act(() => root.render(createElement(Probe)));
    act(() => {
      editor.setHostContent("hello 👩‍💻");
      editor.focusHost();
      expect(editor.insertNewline()).toBe(true);
    });
    const host = editor.hostRef.current!;
    expect(host.textContent).toContain("\u200b");
    const snapshot = editor.captureSnapshot();
    const body = serializeSubmissionSnapshot(snapshot, false);
    expect(body).toBe("hello 👩‍💻\n");
    expect(body).toBe(extractPlainText(host));
    act(() => editor.restoreSnapshot(snapshot));
    expect(serializeSubmissionSnapshot(editor.captureSnapshot(), false)).toBe(
      body
    );
    expect(host.textContent).not.toContain("\u200b");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
