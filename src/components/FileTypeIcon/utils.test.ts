import { describe, expect, it } from "vitest";

import { getFileTypeFromName } from "./utils";

describe("getFileTypeFromName", () => {
  it.each([
    ["numbers", "numbers"],
    ["pages", "pages-doc"],
    ...["doc", "docx", "docm", "dot", "dotx", "dotm"].map((ext) => [
      ext,
      "word",
    ]),
    ...["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm"].map((ext) => [
      ext,
      "excel",
    ]),
    ...[
      "ppt",
      "pptx",
      "pptm",
      "pps",
      "ppsx",
      "ppsm",
      "pot",
      "potx",
      "potm",
    ].map((ext) => [ext, "powerpoint"]),
  ])("maps .%s to %s", (extension, type) => {
    expect(getFileTypeFromName(`report.${extension}`)).toBe(type);
    expect(getFileTypeFromName(`REPORT.${extension.toUpperCase()}`)).toBe(type);
  });
  it("detects dotfiles and rc files before extension fallback", () => {
    expect(getFileTypeFromName(".gitattributes")).toBe("git");
    expect(getFileTypeFromName(".gitignore")).toBe("git");
    expect(getFileTypeFromName(".npmrc")).toBe("npm");
    expect(getFileTypeFromName(".svgrrc")).toBe("svgr");
    expect(getFileTypeFromName(".madgerc")).toBe("rc");
    expect(getFileTypeFromName(".unimportedrc.json")).toBe("rc");
  });
});
