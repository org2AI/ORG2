// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("dropdown entrance animation", () => {
  it("preserves placement from the first frame through the end of the animation", () => {
    const styles = postcss.parse(
      readFileSync(resolve("src/tailwind.css"), "utf8")
    );
    const frames: Record<string, string>[] = [];

    styles.walkAtRules("keyframes", (animation) => {
      if (animation.params !== "dropdown-in") return;
      animation.walkRules((frame) => {
        const declarations: Record<string, string> = {};
        frame.walkDecls((declaration) => {
          declarations[declaration.prop] = declaration.value;
        });
        frames.push(declarations);
      });
    });

    // The panel owns its placement transform. Animating it suppresses end
    // alignment until the animation finishes, even with measured coordinates.
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(Object.keys(frame)).toEqual(["opacity"]);
    }
    expect(frames.map((frame) => frame.opacity)).toEqual(["0", "1"]);
  });
});
