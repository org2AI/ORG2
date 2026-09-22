import { describe, expect, it } from "vitest";

import {
  getFileNameFromFileUrl,
  isLocalFileUrl,
  localPathToFileUrl,
} from "./localFileUrl";

describe("localPathToFileUrl", () => {
  it("converts a POSIX path", () => {
    expect(localPathToFileUrl("/Users/me/site/index.html")).toBe(
      "file:///Users/me/site/index.html"
    );
  });

  it("percent-encodes spaces, unicode, and URL-reserved characters", () => {
    expect(localPathToFileUrl("/Users/me/My Site/报告 #1?.html")).toBe(
      "file:///Users/me/My%20Site/%E6%8A%A5%E5%91%8A%20%231%3F.html"
    );
  });

  it("keeps a backslash inside a POSIX file name as data", () => {
    expect(localPathToFileUrl("/tmp/a\\b.html")).toBe("file:///tmp/a%5Cb.html");
  });

  it("converts a Windows drive path", () => {
    expect(localPathToFileUrl("C:\\Users\\me\\My Site\\index.html")).toBe(
      "file:///C:/Users/me/My%20Site/index.html"
    );
  });

  it("converts a UNC path to a host-qualified URL", () => {
    expect(localPathToFileUrl("\\\\nas\\share\\docs\\index.html")).toBe(
      "file://nas/share/docs/index.html"
    );
  });

  it("round-trips through the URL parser", () => {
    const url = localPathToFileUrl("/Users/me/My Site/报告 #1?.html");
    expect(decodeURIComponent(new URL(url).pathname)).toBe(
      "/Users/me/My Site/报告 #1?.html"
    );
  });

  it("rejects blank and relative input", () => {
    expect(localPathToFileUrl("   ")).toBe("");
    expect(localPathToFileUrl("site/index.html")).toBe("");
  });
});

describe("isLocalFileUrl", () => {
  it("matches file URLs case-insensitively", () => {
    expect(isLocalFileUrl("file:///tmp/a.html")).toBe(true);
    expect(isLocalFileUrl("  FILE:///tmp/a.html")).toBe(true);
  });

  it("rejects network and empty URLs", () => {
    expect(isLocalFileUrl("https://example.com/file://x")).toBe(false);
    expect(isLocalFileUrl("")).toBe(false);
    expect(isLocalFileUrl(undefined)).toBe(false);
  });
});

describe("getFileNameFromFileUrl", () => {
  it("returns the decoded file name", () => {
    expect(
      getFileNameFromFileUrl(
        "file:///Users/me/My%20Site/%E6%8A%A5%E5%91%8A.html"
      )
    ).toBe("报告.html");
  });

  it("returns an empty string when there is no file name", () => {
    expect(getFileNameFromFileUrl("file:///")).toBe("");
    expect(getFileNameFromFileUrl("https://example.com/a.html")).toBe("");
  });
});
