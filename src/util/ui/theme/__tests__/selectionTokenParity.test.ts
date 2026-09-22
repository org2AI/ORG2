import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";

import { TERMINAL_THEMES } from "@src/util/ui/terminal/themes";

describe.each([
  ["light", "orgii_main.css"],
  ["dark", "orgii_dark.css"],
] as const)("%s selection colors", (variant, file) => {
  it("aliases editor and terminal highlights to chat in every theme scope", () => {
    const css = parse(
      readFileSync(resolve(process.cwd(), "public", file), "utf8")
    );
    let aliases = 0;
    let chatColors = 0;
    css.walkDecls((decl) => {
      if (
        decl.prop === "--cm-editor-selection" ||
        decl.prop === "--terminal-selection"
      ) {
        expect(decl.value).toBe("var(--text-selection)");
        aliases++;
      }
      if (decl.prop === "--text-selection") {
        expect(decl.value).toBe(TERMINAL_THEMES[variant].selection);
        chatColors++;
      }
    });
    expect(aliases).toBeGreaterThanOrEqual(2);
    expect(chatColors).toBeGreaterThanOrEqual(1);
  });
});
