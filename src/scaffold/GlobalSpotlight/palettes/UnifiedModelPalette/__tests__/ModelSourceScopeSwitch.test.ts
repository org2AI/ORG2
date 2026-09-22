import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { MODEL_SOURCE_SCOPE } from "@src/store/ui/spotlightModelSourceScopeAtom";

import { ModelSourceScopeSwitch } from "../ModelSourceScopeSwitch";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ theme: "light", isDark: false }),
}));

function render(value: string): string {
  return renderToStaticMarkup(
    createElement(ModelSourceScopeSwitch, {
      value:
        value as (typeof MODEL_SOURCE_SCOPE)[keyof typeof MODEL_SOURCE_SCOPE],
      onChange: () => undefined,
    })
  );
}

it("offers one labelled segment per source kind", () => {
  const markup = render(MODEL_SOURCE_SCOPE.KEYS);

  expect(markup.split("<button")).toHaveLength(3);

  expect(markup).toContain(
    'aria-label="selectors.modelSelector.sourceScope.label"'
  );
  // Icon-only segments carry their name for screen readers and tooltips.
  expect(markup).toContain(
    'aria-label="selectors.modelSelector.sourceScope.keys"'
  );
  expect(markup).toContain('aria-label="integrations:marketConnection.title"');
  expect(markup).not.toContain("sourceScope.label<");
});

it("carries the GUI / TUI launch pill's dimensions", () => {
  const markup = render(MODEL_SOURCE_SCOPE.KEYS);

  expect(markup).toContain("h-[28px]");
  expect(markup).toContain("h-6 px-2.5");
});

it("marks the active scope as pressed", () => {
  const markup = render(MODEL_SOURCE_SCOPE.MARKET);
  const pressed = markup
    .split("<button")
    .filter((segment) => segment.includes('aria-pressed="true"'));

  expect(pressed).toHaveLength(1);
  expect(pressed[0]).toContain(
    'aria-label="integrations:marketConnection.title"'
  );
});
