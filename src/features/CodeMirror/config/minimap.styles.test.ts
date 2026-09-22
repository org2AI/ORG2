// @vitest-environment jsdom
import path from "node:path";
import { type Rule, parse } from "postcss";
import { compile } from "sass";
import { describe, expect, it } from "vitest";

// Editor/index.scss is global CSS in both webpack and rspack. Sass accepts
// :global(...) verbatim, but browsers do not: test the emitted selectors
// against the native DOM that the minimap plugin creates.
const css = parse(
  compile(path.resolve(__dirname, "../Editor/index.scss"), {
    silenceDeprecations: ["import"],
  }).css
);
const rules: Rule[] = [];
css.walkRules((rule) => {
  if (rule.selector.includes("minimap")) rules.push(rule);
});
function declarations(element: HTMLElement) {
  const result: Record<string, string> = {};
  for (const rule of rules) {
    if (element.matches(rule.selector)) {
      rule.walkDecls((declaration) => {
        result[declaration.prop] = declaration.value;
      });
    }
  }
  return result;
}

describe("compiled minimap styles", () => {
  it("positions and paints the viewport without requiring hover", () => {
    const host = document.createElement("div");
    host.className = "codemirror-minimap-host";
    const canvas = host.appendChild(document.createElement("canvas"));
    canvas.className = "minimap-canvas";
    const viewport = host.appendChild(document.createElement("div"));
    viewport.className = "minimap-viewport";
    const styles = declarations(viewport);
    expect(styles.position).toBe("absolute");
    expect(styles.top).toBe("0");
    expect(styles.left).toBe("0");
    expect(styles.right).toBe("0");
    expect(styles.background).toContain("var(--color-text-1) 12%");
    expect(styles["box-shadow"]).toContain("inset 2px 0");
    expect(styles.opacity).not.toBe("0");
    expect(declarations(canvas).position).toBe("absolute");

    host.classList.add("minimap-dragging");
    expect(declarations(viewport).background).toContain("24%");
  });
});
