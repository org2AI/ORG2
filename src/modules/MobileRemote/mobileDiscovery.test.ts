// @vitest-environment jsdom
import { resolve } from "node:path";
import { compile } from "sass";
import { describe, expect, it } from "vitest";

const css = compile(resolve("src/modules/MobileRemote/mobileDiscovery.scss"), {
  quietDeps: true,
}).css;

function rule(selector: string): CSSStyleDeclaration {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const found = Array.from(style.sheet!.cssRules).find(
    (entry) => (entry as CSSStyleRule).selectorText === selector
  ) as CSSStyleRule | undefined;
  style.remove();
  if (!found) throw new Error(`Missing style: ${selector}`);
  return found.style;
}

describe("session row highlight surface", () => {
  it("adds symmetric inset without moving the existing content columns", () => {
    const row = rule(".mobile-session-row");
    expect(row.getPropertyValue("padding")).toBe("12px 8px");
    expect(row.getPropertyValue("margin-inline")).toBe("-8px");
    expect(row.getPropertyValue("width")).toBe("calc(100% + 16px)");
    expect(row.getPropertyValue("border-radius")).toBe("12px");
  });

  it("keeps compact rows touch-sized without overriding horizontal inset", () => {
    const compact = rule(".mobile-session-row--compact");
    expect(compact.getPropertyValue("min-height")).toBe("44px");
    expect(compact.getPropertyValue("padding-block")).toBe("8px");
    expect(compact.getPropertyValue("padding")).toBe("");
    expect(compact.getPropertyValue("padding-inline")).toBe("");
  });
});
