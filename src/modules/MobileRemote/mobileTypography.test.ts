import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("./", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("mobile typography contract", () => {
  it("compiles root-scoped roles for both normal and portaled mobile UI", () => {
    const css = compile(`${root}mobileViewport.scss`).css;
    expect(css).toContain("--mobile-type-body-size: 1rem");
    expect(css).toContain("--mobile-type-code-size: 0.8125rem");
    expect(css).toContain("html .mobile-type-caption");
    expect(css).toContain("--chat-font-size: var(--mobile-type-body-size)");
    expect(css).toContain(
      "--chat-code-font-size: var(--mobile-type-code-size)"
    );
    expect(css).not.toMatch(/--text-(xs|sm|base|lg):/);
    expect(css).not.toMatch(/font-size:\s*\d+px/);
    for (const entry of [
      "mobileRemoteEntry.tsx",
      "mobileRemoteNativeEntry.tsx",
    ]) {
      expect(read(`../../${entry}`)).toContain(
        "MobileRemote/mobileViewport.scss"
      );
    }
  });

  it("resolves every mobile typography reference to a centrally declared token", () => {
    const css = compile(`${root}mobileViewport.scss`).css;
    const declarations = new Set(
      [...css.matchAll(/(--mobile-type-[\w-]+):/g)].map((match) => match[1])
    );
    for (const file of readdirSync(root, { recursive: true }) as string[]) {
      if (!/\.(scss|tsx)$/.test(file)) continue;
      for (const match of read(file).matchAll(
        /var\((--mobile-type-[\w-]+)\)/g
      )) {
        expect(declarations.has(match[1]), `${file}: ${match[1]}`).toBe(true);
      }
    }
  });

  it("keeps literal mobile type sizes in the central scale, not consumers", () => {
    for (const file of readdirSync(root, { recursive: true }) as string[]) {
      if (!/\.(scss|tsx)$/.test(file) || file === "_mobileTypography.scss")
        continue;
      expect(read(file), file).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px/);
      expect(read(file), file).not.toMatch(/fontSize:\s*\d/);
      expect(read(file), file).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
    }
  });
});
