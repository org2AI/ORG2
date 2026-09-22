import { describe, expect, it } from "vitest";

import { getToolCallTitle } from "../toolCallTitle";

describe("getToolCallTitle", () => {
  it.each(["js", "cua_repl.js", "mcp__cua_repl.js", "mcp__cua_repl__js"])(
    "reads a trimmed invocation description from %s",
    (name) => {
      expect(getToolCallTitle(name, { title: "  Inspect window  " })).toBe(
        "Inspect window"
      );
    }
  );

  it.each([undefined, null, "", "   ", 42, { text: "title" }])(
    "rejects an unusable title: %j",
    (title) => {
      expect(getToolCallTitle("js", { title })).toBeUndefined();
    }
  );

  it("leaves business titles and missing args alone", () => {
    for (const name of [
      "create_document",
      "manage_work_item",
      "send_to_inbox",
      "other__js",
    ]) {
      expect(
        getToolCallTitle(name, { title: "Document title" })
      ).toBeUndefined();
    }
    expect(getToolCallTitle("js", undefined)).toBeUndefined();
  });
});
