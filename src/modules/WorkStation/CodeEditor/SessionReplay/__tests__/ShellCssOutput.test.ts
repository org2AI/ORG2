import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SimulatorShellCssOutput } from "../ShellCssOutput";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("Agent Station command highlighting", () => {
  it("highlights the command with theme tokens and leaves output plain", () => {
    const markup = renderToStaticMarkup(
      createElement(SimulatorShellCssOutput, {
        command: "git status --short",
        output: "ordinary output --plain",
      })
    );
    expect(markup).toContain('class="token function">git</span>');
    expect(markup).toContain('class="token parameter">--short</span>');
    expect(markup).toContain("ordinary output --plain");
  });
});
