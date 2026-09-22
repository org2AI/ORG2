import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type AtRule, type Container, type Document } from "postcss";
import { compileString } from "sass";
import { describe, expect, it } from "vitest";

// Tailwind v4 emits utilities in `@layer utilities`, and unlayered CSS beats
// every layered rule. These checks keep the Input wrapper's box defaults and
// the <input> element's own styles below utilities, so `className` and
// `inputClassName` utilities apply, while the modifiers that must beat Input's
// own `rounded-lg bg-bg-2` utilities stay unlayered.

interface CompiledRule {
  selector: string;
  layer: string | null;
  props: string[];
}

function compileInputStyles() {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/Input/index.scss"),
    "utf8"
  );
  const root = postcss.parse(compileString(source).css);
  const layerStatements: string[] = [];
  root.walkAtRules("layer", (atRule) => {
    if (!atRule.nodes) layerStatements.push(atRule.params);
  });
  const rules: CompiledRule[] = [];
  root.walkRules((rule) => {
    let layer: string | null = null;
    let node: Container | Document | undefined = rule.parent;
    while (node) {
      if (node.type === "atrule" && (node as AtRule).name === "layer") {
        layer = (node as AtRule).params;
      }
      node = node.parent;
    }
    rules.push({
      selector: rule.selector,
      layer,
      props: rule.nodes.flatMap((child) =>
        child.type === "decl" ? [child.prop] : []
      ),
    });
  });
  return { layerStatements, rules };
}

const { layerStatements, rules } = compileInputStyles();

const rulesFor = (selector: string) =>
  rules.filter((rule) => rule.selector === selector);

/** A selector whose subject is the wrapper itself (no descendant part). */
const WRAPPER_SUBJECT = /^\.input-wrapper(?:\.[\w-]+|:[\w-]+(?:\([^)]*\))?)*$/;

/** Box properties callers set through `className` utilities. */
const CALLER_SIZED_PROPS = [
  "width",
  "height",
  "min-width",
  "max-width",
  "display",
  "font-size",
  "border-radius",
];

describe("Input stylesheet cascade layers", () => {
  it("declares Tailwind's layer order before any layered rule", () => {
    expect(layerStatements[0]).toBe(
      "properties, theme, base, components, utilities"
    );
  });

  it.each([
    [".input-wrapper", "width"],
    [".input-wrapper", "display"],
    [".input-wrapper.input-size-mini", "height"],
    [".input-wrapper.input-size-small", "height"],
    [".input-wrapper.input-size-default", "height"],
    [".input-wrapper.input-size-large", "height"],
    [".input-wrapper.input-auto-height", "height"],
    [".input-wrapper.input-field-ghost", "min-width"],
    [".input-wrapper.input-field-ghost", "max-width"],
  ])("keeps %s { %s } in @layer components", (selector, prop) => {
    const declaring = rulesFor(selector).filter((rule) =>
      rule.props.includes(prop)
    );
    expect(declaring).not.toHaveLength(0);
    expect(declaring.map((rule) => rule.layer)).toEqual(
      declaring.map(() => "components")
    );
  });

  it("leaves no unlayered wrapper box declaration to shadow utilities", () => {
    const shadowing = rules
      .filter(
        (rule) =>
          rule.layer === null &&
          rule.selector
            .split(",")
            .some((part) => WRAPPER_SUBJECT.test(part.trim()))
      )
      .flatMap((rule) =>
        rule.props
          .filter((prop) => CALLER_SIZED_PROPS.includes(prop))
          .map((prop) => `${rule.selector} { ${prop} }`)
      );
    expect(shadowing).toEqual([]);
  });

  it.each([
    [".input", "padding"],
    [".input", "color"],
    [".input", "border"],
    [".input", "background"],
    [".input", "border-radius"],
    [".input", "box-shadow"],
    [".input::placeholder", "color"],
    [".input-wrapper.input-size-mini .input", "font-size"],
    [
      ".input-wrapper.input-size-small .input, .input-wrapper.input-size-default .input, .input-wrapper.input-size-large .input",
      "font-size",
    ],
    [".input-wrapper.input-auto-height .input", "line-height"],
    [".input-wrapper.input-field-ghost .input", "font-weight"],
  ])(
    "keeps the input element's %s { %s } in @layer components",
    (selector, prop) => {
      const declaring = rulesFor(selector).filter((rule) =>
        rule.props.includes(prop)
      );
      expect(declaring).not.toHaveLength(0);
      expect(declaring.map((rule) => rule.layer)).toEqual(
        declaring.map(() => "components")
      );
    }
  );

  it("leaves no unlayered input element style to shadow inputClassName", () => {
    const INPUT_STYLED_PROPS = new Set([
      "padding",
      "margin",
      "height",
      "border",
      "border-radius",
      "background",
      "background-color",
      "box-shadow",
      "outline",
      "color",
      "font-size",
      "font-weight",
      "line-height",
      "transform",
      "white-space",
    ]);
    const shadowing = rules
      .filter(
        (rule) =>
          rule.layer === null &&
          rule.selector
            .split(",")
            .some((part) => /\.input(?:[:[]|$)/.test(part.trim()))
      )
      // Date/time segment selection colors are not caller-styled.
      .filter((rule) => !rule.selector.includes("::selection"))
      .filter((rule) => !rule.selector.includes("::-webkit-datetime-edit"))
      .flatMap((rule) =>
        rule.props
          .filter((prop) => INPUT_STYLED_PROPS.has(prop))
          .map((prop) => `${rule.selector} { ${prop} }`)
      );
    expect(shadowing).toEqual([]);
  });

  it.each([
    ".input-wrapper.input-pane-surface .input-inner",
    ".input-wrapper.input-focused .input-inner",
    ".input-wrapper.input-field-ghost .input-inner, .input-wrapper.input-field-bare .input-inner",
  ])(
    "keeps %s unlayered so it still beats Input's own utilities",
    (selector) => {
      const matching = rulesFor(selector);
      expect(matching).not.toHaveLength(0);
      expect(matching.every((rule) => rule.layer === null)).toBe(true);
    }
  );
});
