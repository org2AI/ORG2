import { createStore } from "jotai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";

import { settingsAtom } from "@src/store/settings/settingsAtom";

import {
  CODE_FONT_FAMILY_CSS,
  resolvedCodeFontFamilyAtom,
} from "../editorSettingsAtom";

describe("shared code font", () => {
  it.each(["System Default", "Hack", "Custom"] as const)(
    "resolves %s and preserves explicit font choices",
    (preset) => {
      const store = createStore();
      store.set(settingsAtom, {
        ...store.get(settingsAtom),
        "editor.fontFamily": preset,
        "editor.customFontFamily": "  My Mono  ",
      });
      const font = store.get(resolvedCodeFontFamilyAtom);
      if (preset === "Hack") expect(font).toBe(CODE_FONT_FAMILY_CSS.hack);
      else if (preset === "Custom") {
        expect(font).toBe(`"My Mono", ${CODE_FONT_FAMILY_CSS.system}`);
      } else expect(font).toBe(CODE_FONT_FAMILY_CSS.system);
    }
  );

  it("uses the shared system stack when a custom font is empty", () => {
    const store = createStore();
    store.set(settingsAtom, {
      ...store.get(settingsAtom),
      "editor.fontFamily": "Custom",
      "editor.customFontFamily": "   ",
    });
    expect(store.get(resolvedCodeFontFamilyAtom)).toBe(
      CODE_FONT_FAMILY_CSS.system
    );
  });

  it.each(["orgii_main.css", "orgii_dark.css"])(
    "%s matches the runtime default and allows user font inheritance",
    (file) => {
      const css = parse(
        readFileSync(resolve(process.cwd(), "public", file), "utf8")
      );
      let rootFont: string | undefined;
      css.walkDecls(/^(--code-font-family|--cm-font-family)$/, (decl) => {
        if (decl.parent?.type !== "rule") return;
        // The settings hook writes to :root. Any descendant declaration can
        // shadow that choice and make CSS code surfaces diverge from xterm.
        expect(decl.parent.selector).toBe(":root");
        if (decl.prop === "--code-font-family") rootFont = decl.value;
        else expect(decl.value).toBe("var(--code-font-family)");
      });
      expect(rootFont?.replace(/\s+/g, " ")).toBe(CODE_FONT_FAMILY_CSS.system);
    }
  );
});
