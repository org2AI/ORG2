import { highlightingFor } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { createGithubTheme } from "./github";

describe("shared CodeMirror diff theme", () => {
  it("maps inserted, deleted and hunk tokens to distinct highlight classes", () => {
    const state = EditorState.create({ extensions: [createGithubTheme()] });
    const inserted = highlightingFor(state, [tags.inserted]);
    const deleted = highlightingFor(state, [tags.deleted]);
    const hunk = highlightingFor(state, [tags.meta]);
    expect(inserted).toBeTruthy();
    expect(deleted).toBeTruthy();
    expect(hunk).toBeTruthy();
    expect(new Set([inserted, deleted, hunk]).size).toBe(3);
  });
});
