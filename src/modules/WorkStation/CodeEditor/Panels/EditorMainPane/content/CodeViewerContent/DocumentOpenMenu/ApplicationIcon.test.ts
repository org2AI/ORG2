import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import ApplicationIcon from "./ApplicationIcon";
import { getDocumentApplicationIcon } from "./applicationIcons";

it.each([
  "Numbers",
  "Pages",
  "Keynote",
  "Preview",
  "Books",
  "QuickTime Player",
])("uses an app asset for %s", (app) => {
  expect(getDocumentApplicationIcon(`/Applications/${app}.app`)).toContain(
    "/documentApps/"
  );
});

it("renders an external-link glyph instead of a file image for unknown apps", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ApplicationIcon, { path: "/Applications/Unknown.app" })
  );
  expect(markup).toContain("<svg");
  expect(markup).not.toContain("<img");
  expect(getDocumentApplicationIcon()).toBeUndefined();
});
