import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useTestTranslation } from "@src/test/i18nTestTranslate";

import {
  OrganizationScopeHeader,
  type OrganizationScopeOption,
} from "./OrganizationScopeHeader";

vi.mock("react-i18next", () => ({
  useTranslation: (...args: Parameters<typeof useTestTranslation>) =>
    useTestTranslation(...args),
}));

const LOCAL_ONLY: OrganizationScopeOption[] = [
  { value: "personal", label: "My workspace", scope: "local" },
];

const LOCAL_AND_CLOUD: OrganizationScopeOption[] = [
  ...LOCAL_ONLY,
  { value: "cloud:org-1", label: "ORG2 OSS", scope: "cloud" },
  { value: "cloud:org-2", label: "ORG2 Labs", scope: "cloud" },
];

function render(
  value: string,
  options: OrganizationScopeOption[],
  onChange = vi.fn()
) {
  return renderToStaticMarkup(
    createElement(OrganizationScopeHeader, {
      value,
      options,
      onChange,
      tabControl: createElement("div", null, "Overview"),
      dataTestId: "organization-header",
      selectorDataTestId: "organization-selector",
    })
  );
}

describe("OrganizationScopeHeader", () => {
  it("leads with a local | cloud scope switch", () => {
    const markup = render("personal", LOCAL_AND_CLOUD);

    expect(markup).toContain('data-testid="organization-selector-scope"');
    expect(markup).toContain("Local");
    expect(markup).toContain("Cloud");
  });

  it("hides the organization selector for a single-entry local scope", () => {
    const markup = render("personal", LOCAL_AND_CLOUD);

    expect(markup).not.toContain('data-testid="organization-selector"');
    expect(markup).not.toContain("ORG2 OSS");
  });

  it("still names the cloud organization when there is only one", () => {
    const markup = render("cloud:org-1", [
      ...LOCAL_ONLY,
      { value: "cloud:org-1", label: "ORG2 OSS", scope: "cloud" },
    ]);

    expect(markup).toContain('data-testid="organization-selector"');
    expect(markup).toContain("ORG2 OSS");
  });

  it("shows the organization selector once the cloud scope is active", () => {
    const markup = render("cloud:org-1", LOCAL_AND_CLOUD);

    expect(markup).toContain('data-testid="organization-selector"');
    expect(markup).toContain("ORG2 OSS");
  });

  it("fences the switch off from the organization selector with its own divider", () => {
    const markup = render("cloud:org-1", LOCAL_AND_CLOUD);

    expect(
      markup.indexOf('data-testid="organization-selector-scope-separator"')
    ).toBeGreaterThan(
      markup.indexOf('data-testid="organization-selector-scope"')
    );
    expect(
      markup.indexOf('data-testid="organization-selector"')
    ).toBeGreaterThan(
      markup.indexOf('data-testid="organization-selector-scope-separator"')
    );
  });

  it("left-aligns the row and spaces every divider the same", () => {
    const markup = render("cloud:org-1", LOCAL_AND_CLOUD);

    // The row itself, not the segment buttons that centre their own labels.
    const row = markup.match(/<div class="([^"]*max-w-\[932px\][^"]*)"/)?.[1];
    expect(row).toBeDefined();
    expect(row).not.toContain("justify-center");
    // The nested control cluster and the tab strip share one gap, so the
    // divider before the tabs is not tighter on one side than the other.
    expect([...markup.matchAll(/gap-3\.5/g)]).toHaveLength(2);
  });

  it("drops the leading divider when the switch stands alone", () => {
    const markup = render("personal", LOCAL_AND_CLOUD);

    expect(markup).not.toContain(
      'data-testid="organization-selector-scope-separator"'
    );
    expect(markup).toContain('data-testid="organization-selector-separator"');
  });

  it("keeps the title-row selector permanently chromeless", () => {
    const markup = render("cloud:org-1", LOCAL_AND_CLOUD);

    expect(markup).toContain("select-size-large");
    expect(markup).toContain("select-bare");
    expect(markup).toContain("select-title-row");
    expect(markup).not.toContain("select-ghost");
  });

  it("disables a scope segment that has no organization to select", () => {
    const segments = [
      ...render("personal", LOCAL_ONLY).matchAll(
        /<button ([^>]*)>([^<]*)<\/button>/g
      ),
    ].map(([, attributes, label]) => ({
      label,
      disabled: attributes.includes("disabled"),
    }));

    expect(segments).toEqual([
      { label: "Local", disabled: false },
      { label: "Cloud", disabled: true },
    ]);
  });
});
