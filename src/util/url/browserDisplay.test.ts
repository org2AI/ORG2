import { describe, expect, it } from "vitest";

import { getFaviconUrl, getSiteNameFromUrl } from "./browserDisplay";

describe("getSiteNameFromUrl", () => {
  it("names a web page after its site", () => {
    expect(getSiteNameFromUrl("https://www.google.com.hk/search?q=a")).toBe(
      "Google"
    );
    expect(getSiteNameFromUrl("http://localhost:3000/")).toBe("localhost");
  });

  it("names a local file after the file, which has no host", () => {
    expect(getSiteNameFromUrl("file:///Users/me/My%20Site/report.html")).toBe(
      "report.html"
    );
  });

  it("falls back to the placeholder title", () => {
    expect(getSiteNameFromUrl(undefined)).toBe("New Tab");
    expect(getSiteNameFromUrl("file:///")).toBe("New Tab");
    expect(getSiteNameFromUrl("not a url")).toBe("New Tab");
  });
});

describe("getFaviconUrl", () => {
  it("has no favicon service URL for a local file", () => {
    expect(getFaviconUrl("file:///Users/me/report.html")).toBeUndefined();
  });
});
