import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import type { CommitDiffResult } from "@src/api/http/git/types";

import { CommitInfoPanel } from "./CommitInfoPanel";

it.each(["", "  \n\t"])(
  "omits the entire strip for an empty body %j",
  (body) => {
    expect(
      renderToStaticMarkup(
        createElement(CommitInfoPanel, {
          commitDiff: { body } as CommitDiffResult,
        })
      )
    ).toBe("");
  }
);

it("preserves a populated commit body", () => {
  const markup = renderToStaticMarkup(
    createElement(CommitInfoPanel, {
      commitDiff: { body: "Details\n  with indentation" } as CommitDiffResult,
    })
  );
  expect(markup).toContain("Details\n  with indentation");
  expect(markup).toContain("border-b");
});
