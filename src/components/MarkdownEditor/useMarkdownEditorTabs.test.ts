import path from "node:path";
import { describe, expect, it } from "vitest";

import { SRC_ROOT, walkStaticImports } from "@src/test/staticImportGraph";

describe("markdown tab hook dependency boundary", () => {
  it("does not load the editor or preview renderer to obtain tab labels", () => {
    const graph = walkStaticImports([
      "components/MarkdownEditor/useMarkdownEditorTabs.ts",
    ]);
    expect(
      [...graph.files].map((file) => path.relative(SRC_ROOT, file))
    ).toEqual(["components/MarkdownEditor/useMarkdownEditorTabs.ts"]);
    expect([...graph.packages].sort()).toEqual(["react", "react-i18next"]);
  });
});
