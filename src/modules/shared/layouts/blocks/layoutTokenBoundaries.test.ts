import { describe, expect, it } from "vitest";

import {
  reachableFilesMatching,
  walkStaticImports,
} from "@src/test/staticImportGraph";

describe("layout token dependency boundaries", () => {
  it.each([
    "modules/shared/layouts/blocks/PanelHeader/tokens.ts",
    "modules/shared/layouts/blocks/workstationTrailTokens.ts",
    "modules/shared/layouts/FocusedChatWorkstationRail/trailWidth.ts",
    "engines/ChatPanel/focusedChatWorkstationLayout.ts",
  ])("keeps %s independent of layout renderers", (entry) => {
    const graph = walkStaticImports([entry]);
    expect(
      reachableFilesMatching(
        graph,
        /(?:PanelHeader\/index|WorkstationTrailSurface)\.tsx$/
      )
    ).toEqual([]);
    expect(graph.packages.has("react")).toBe(false);
    expect(graph.packages.has("@hugeicons/core-free-icons")).toBe(false);
  });
});
