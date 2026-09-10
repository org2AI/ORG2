import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { walkStaticImports } from "@src/test/staticImportGraph";

import { EXT_TO_LANG_MAP, getLanguageKey } from "./languageDetection";
import { langCacheSet } from "./languageExtensionCache";
import { getLanguageExtension } from "./languageExtensions";
import {
  getLanguageExtensionSync,
  loadLanguageExtension,
} from "./lazyLanguageExtensions";

vi.mock("@codemirror/lang-python", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@codemirror/lang-python")>();
  return { ...actual, python: vi.fn(actual.python) };
});

const synchronous = new Set(["javascript", "jsx", "typescript", "tsx"]);

describe("CodeMirror language loading boundary", () => {
  it("keeps all non-JS parsers outside the editor's static import graph", () => {
    const graph = walkStaticImports([
      "features/CodeMirror/Editor/hooks/useLazyLanguageExtension.ts",
    ]);
    expect(
      [...graph.packages].filter(
        (name) =>
          (name.startsWith("@codemirror/lang-") &&
            name !== "@codemirror/lang-javascript") ||
          name.startsWith("@codemirror/legacy-modes")
      )
    ).toEqual([]);
    expect(
      [...graph.files].some((name) =>
        name.endsWith("/shared/languageExtensions.ts")
      )
    ).toBe(false);
    expect(graph.packages.has("@codemirror/lang-javascript")).toBe(true);
  });

  it("keeps detection free of parser dependencies", () => {
    const graph = walkStaticImports([
      "features/CodeMirror/shared/languageDetection.ts",
    ]);
    expect(graph.packages.size).toBe(0);
  });

  it.each(Object.entries(EXT_TO_LANG_MAP))(
    "preserves eager and lazy support for .%s",
    async (suffix, key) => {
      expect(getLanguageKey(`file.${suffix.toUpperCase()}`)).toBe(key);
      const eager = getLanguageExtension(`file.${suffix}`);
      const lazy = synchronous.has(key)
        ? getLanguageExtensionSync(key)
        : await loadLanguageExtension(key);
      expect(eager).not.toBeNull();
      expect(lazy).not.toBeNull();
      // Real parser extensions must remain accepted by CodeMirror configuration.
      expect(() =>
        EditorState.create({ doc: "sample", extensions: [eager!, lazy!] })
      ).not.toThrow();
      expect(getLanguageExtension(`other.${suffix}`)).toBe(eager);
      expect(
        synchronous.has(key)
          ? getLanguageExtensionSync(key)
          : await loadLanguageExtension(key)
      ).toBe(lazy);
    }
  );

  it("preserves override precedence and unknown-language fallback", async () => {
    expect(getLanguageKey("file.py", "TSX")).toBe("tsx");
    expect(getLanguageKey()).toBeNull();
    expect(getLanguageKey("file.unknown")).toBeNull();
    expect(getLanguageExtension(undefined, "unknown")).toBeNull();
    expect(getLanguageExtensionSync("python")).toBeNull();
    const cached = await loadLanguageExtension("rust");
    for (let i = 0; i < 100; i++) {
      expect(await loadLanguageExtension(`unknown-${i}`)).toBeNull();
    }
    expect(await loadLanguageExtension("rust")).toBe(cached);
  });

  it("deduplicates concurrent requests and retries failed parser construction", async () => {
    vi.resetModules();
    const { python } = await import("@codemirror/lang-python");
    vi.mocked(python).mockImplementationOnce(() => {
      throw new Error("load failure");
    });
    const loader = await import("./lazyLanguageExtensions");
    const first = loader.loadLanguageExtension("python");
    expect(loader.loadLanguageExtension("python")).toBe(first);
    expect(await first).toBeNull();
    const retry = loader.loadLanguageExtension("python");
    expect(retry).not.toBe(first);
    expect(await retry).not.toBeNull();
    expect(await loader.loadLanguageExtension("python")).toBe(await retry);
  });

  it("caps retained extensions and evicts the oldest entry", () => {
    const cache = new Map<string, number>();
    for (let i = 0; i < 100; i++) langCacheSet(cache, String(i), i);
    expect(cache.size).toBe(64);
    expect(cache.has("35")).toBe(false);
    expect(cache.get("36")).toBe(36);
    expect(cache.get("99")).toBe(99);
  });
});
