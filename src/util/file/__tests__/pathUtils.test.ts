import {
  decodeOctalPath,
  getBaseName,
  getDirectory,
  getFileExtension,
  getFileExtensionLower,
  getFileName,
} from "../pathUtils";

describe("decodeOctalPath", () => {
  it("passes through plain ASCII", () => {
    expect(decodeOctalPath("plain-ascii.ts")).toBe("plain-ascii.ts");
  });

  it("decodes quoted path with octal bytes", () => {
    expect(decodeOctalPath('"He_CV\\344\\270\\255.pdf"')).toBe("He_CV中.pdf");
  });

  it("is no-op when no backslash", () => {
    expect(decodeOctalPath("no-backslash-here.txt")).toBe(
      "no-backslash-here.txt"
    );
  });
});

describe("getFileExtension", () => {
  it("returns extension without dot for normal paths", () => {
    expect(getFileExtension("src/components/Button.tsx")).toBe("tsx");
    expect(getFileExtension("README.md")).toBe("md");
  });

  it("returns empty when no extension", () => {
    expect(getFileExtension("README")).toBe("");
  });

  it("treats dotfiles as having extension after first dot", () => {
    expect(getFileExtension(".gitignore")).toBe("gitignore");
  });

  it("returns empty for empty string", () => {
    expect(getFileExtension("")).toBe("");
  });

  it("uses the last dot of multi-dot file names", () => {
    expect(getFileExtension("file.test.ts")).toBe("ts");
    expect(getFileExtension("jquery.min.js")).toBe("js");
  });

  it("ignores dots in directory names", () => {
    expect(getFileExtension("src/v1.2/README")).toBe("");
    expect(getFileExtension("dir.v2/file.ts")).toBe("ts");
    expect(getFileExtension("a/b.c/d")).toBe("");
  });

  it("ignores dots in Windows-style directory names", () => {
    expect(getFileExtension("C:\\x.y\\z.md")).toBe("md");
    expect(getFileExtension("C:\\x.y\\README")).toBe("");
  });

  it("treats dotfiles inside directories like bare dotfiles", () => {
    expect(getFileExtension("repo/.gitignore")).toBe("gitignore");
    expect(getFileExtension("Users/me/.DS_Store")).toBe("DS_Store");
  });
});

describe("getFileName", () => {
  it("returns last segment with directory", () => {
    expect(getFileName("src/components/Button.tsx")).toBe("Button.tsx");
  });

  it("returns whole path when no separator", () => {
    expect(getFileName("README.md")).toBe("README.md");
  });

  it("returns empty for empty input", () => {
    expect(getFileName("")).toBe("");
  });

  it("handles Windows backslash separators", () => {
    expect(getFileName("src\\components\\Button.tsx")).toBe("Button.tsx");
    expect(getFileName("C:\\Users\\dev\\project\\main.rs")).toBe("main.rs");
  });

  it("handles mixed separators", () => {
    expect(getFileName("src/components\\Button.tsx")).toBe("Button.tsx");
  });
});

describe("getBaseName", () => {
  it("strips extension when present", () => {
    expect(getBaseName("src/components/Button.tsx")).toBe("Button");
  });

  it("returns full name when no extension", () => {
    expect(getBaseName("file")).toBe("file");
  });

  it("returns empty for empty input", () => {
    expect(getBaseName("")).toBe("");
  });
});

describe("getDirectory", () => {
  it("returns directory for nested path", () => {
    expect(getDirectory("src/components/Button.tsx")).toBe("src/components");
  });

  it("returns empty for flat filename", () => {
    expect(getDirectory("README.md")).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(getDirectory("")).toBe("");
  });

  it("handles Windows backslash separators", () => {
    expect(getDirectory("src\\components\\Button.tsx")).toBe("src/components");
    expect(getDirectory("C:\\Users\\dev\\project\\main.rs")).toBe(
      "C:/Users/dev/project"
    );
  });

  it("handles mixed separators", () => {
    expect(getDirectory("src/components\\Button.tsx")).toBe("src/components");
  });
});

describe("getFileExtensionLower", () => {
  it("lowercases extension", () => {
    expect(getFileExtensionLower("Image.PNG")).toBe("png");
    expect(getFileExtensionLower("a.TxT")).toBe("txt");
  });

  it("ignores dots in directory names", () => {
    expect(getFileExtensionLower("src/v1.2/README")).toBe("");
    expect(getFileExtensionLower("dir.v2/Image.PNG")).toBe("png");
  });
});
