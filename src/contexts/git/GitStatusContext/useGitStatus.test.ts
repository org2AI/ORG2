import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  reachableFilesMatching,
  walkStaticImports,
} from "@src/test/staticImportGraph";

import { GitStatusContext } from "./context";
import type { GitStatusContextValue } from "./types";
import { useGitStatus } from "./useGitStatus";

describe("useGitStatus read boundary", () => {
  it("reads the exact provider value and refresh action", () => {
    const value: GitStatusContextValue = {
      currentGitStatus: null,
      scopedGitStatus: null,
      gitSuggestedAction: null,
      loading: false,
      error: "repository unavailable",
      forceRefresh: async () => {},
      hasActiveRepo: true,
    };
    function Reader() {
      const observed = useGitStatus();
      expect(observed).toBe(value);
      expect(observed.forceRefresh).toBe(value.forceRefresh);
      return createElement("span", null, observed.error);
    }
    expect(
      renderToStaticMarkup(
        createElement(
          GitStatusContext.Provider,
          { value },
          createElement(Reader)
        )
      )
    ).toBe("<span>repository unavailable</span>");
  });

  it("preserves the missing-provider error", () => {
    function Reader() {
      useGitStatus();
      return null;
    }
    expect(() => renderToStaticMarkup(createElement(Reader))).toThrow(
      "useGitStatus must be used within GitStatusProvider"
    );
  });

  it("does not bring provider lifecycle or application state into a reader", () => {
    const graph = walkStaticImports([
      "contexts/git/GitStatusContext/useGitStatus.ts",
    ]);
    expect(
      reachableFilesMatching(
        graph,
        /GitStatusProvider|DeferredGitStatusProvider|\/hooks\/|^store\//
      )
    ).toEqual([]);
    expect([...graph.packages]).toEqual(["react"]);
    expect(reachableFilesMatching(graph, /context\.ts$/)).toEqual([
      "contexts/git/GitStatusContext/context.ts",
    ]);
  });
});
