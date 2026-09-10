import { describe, expect, it } from "vitest";

import {
  reachableFilesMatching,
  walkStaticImports,
} from "@src/test/staticImportGraph";

describe("SessionHoverCard loading boundary", () => {
  it("keeps the details renderer and session overview outside the trigger's static graph", () => {
    const graph = walkStaticImports(["components/SessionHoverCard/index.tsx"]);

    expect(
      reachableFilesMatching(
        graph,
        /SessionHoverCard\/(?:SessionHoverCardContent\.tsx|useSessionTurnOverview\.ts)$/
      )
    ).toEqual([]);
    expect(
      reachableFilesMatching(graph, /SessionHoverCard\/HoverCardBase\.tsx$/)
    ).toEqual(["components/SessionHoverCard/HoverCardBase.tsx"]);
  });
});
