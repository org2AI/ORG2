/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderAllFilterIcon } from "@src/components/SettingsTable/filterIcons";

import {
  buildFamilyExemplars,
  renderFamilyFilterIcon,
} from "./modelFilterIcons";

const CATALOG = [
  "gpt-6-astra",
  "claude-opus-5",
  "glm-5.2",
  // Cursor's whole family is routing-tier ids, which name no model.
  "auto",
  "default",
];

function markupFor(family: string): string {
  const icon = renderFamilyFilterIcon(family, buildFamilyExemplars(CATALOG));
  return icon == null ? "" : renderToStaticMarkup(icon as React.ReactElement);
}

describe("renderFamilyFilterIcon", () => {
  it("routes a provider filter by its provider, not by a sample model", () => {
    // Cursor's only models are tier ids, so borrowing a model's icon yields
    // the neutral placeholder. The row labels the provider, so it must not.
    const cursor = markupFor("Cursor");
    expect(cursor).not.toBe("");
    expect(cursor).not.toContain("unknown");
  });

  it("still resolves families the icon registry knows by name", () => {
    for (const family of ["OpenAI", "Claude", "Zhipu"]) {
      expect(markupFor(family)).not.toBe("");
    }
  });

  it("gives no icon to a family with neither a provider nor a usable model", () => {
    expect(markupFor("Other")).toBe("");
  });

  it("gives the unfiltered row a mark so the list does not read ragged", () => {
    expect(
      renderToStaticMarkup(renderAllFilterIcon() as React.ReactElement)
    ).toContain("<svg");
  });

  it("lets a selected row tint its own mark instead of pinning a colour", () => {
    // A hard-coded text-* class would survive selection and leave the mark grey
    // while the option's label turns primary-6.
    expect(
      renderToStaticMarkup(renderAllFilterIcon() as React.ReactElement)
    ).not.toMatch(/class="[^"]*text-/);
  });
});
