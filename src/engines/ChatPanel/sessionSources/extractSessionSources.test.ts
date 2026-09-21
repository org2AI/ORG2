import { describe, expect, it } from "vitest";

import { extractSessionSources } from "./extractSessionSources";

describe("extractSessionSources", () => {
  it("lists images and links newest message first", () => {
    const sources = extractSessionSources([
      {
        id: "u1",
        text: "look at https://example.com/docs.",
        images: ["/Users/me/.orgii/session-images/abc.png"],
      },
      {
        id: "u2",
        text: "and this example.org/page [link:https://example.org/page]",
      },
    ]);

    expect(sources).toEqual([
      {
        kind: "link",
        key: "link:https://example.org/page",
        url: "https://example.org/page",
        label: "example.org/page",
      },
      {
        kind: "image",
        key: "image:/Users/me/.orgii/session-images/abc.png",
        ref: "/Users/me/.orgii/session-images/abc.png",
        fileName: "abc.png",
      },
      {
        kind: "link",
        key: "link:https://example.com/docs",
        url: "https://example.com/docs",
        label: "example.com/docs",
      },
    ]);
  });

  it("keeps a repeated source only at its most recent position", () => {
    const sources = extractSessionSources([
      { id: "u1", text: "https://example.com/a/", images: ["/tmp/shot.png"] },
      { id: "u2", text: "again https://example.com/a#intro" },
      { id: "u3", text: "", images: ["/tmp/shot.png"] },
    ]);

    expect(sources.map((source) => source.key)).toEqual([
      "image:/tmp/shot.png",
      "link:https://example.com/a",
    ]);
  });

  it("reads Codex attachment envelopes and Markdown links like the bubble does", () => {
    const shot = "/var/folders/T/Screenshot 2026-09-16 at 10.35.47 PM.png";
    const sources = extractSessionSources([
      {
        id: "codex",
        text: [
          "# Files mentioned by the user:",
          "",
          `## Screenshot 2026-09-16 at 10.35.47 PM.png: ${shot}`,
          "## notes.md: /Users/me/notes.md",
          "",
          "## My request:",
          "should we merge [PR 602](https://github.com/org2AI/ORG2/pull/602)",
        ].join("\n"),
        images: [`orgii-transcript-image:${JSON.stringify(["s", "t", shot])}`],
      },
    ]);

    expect(sources).toEqual([
      expect.objectContaining({
        kind: "image",
        fileName: "Screenshot 2026-09-16 at 10.35.47 PM.png",
      }),
      {
        kind: "link",
        key: "link:https://github.com/org2AI/ORG2/pull/602",
        url: "https://github.com/org2AI/ORG2/pull/602",
        label: "org2AI/ORG2#602",
      },
    ]);
  });

  it("gives inline images a per-message identity and no file name", () => {
    const inline = "data:image/png;base64,AAAA";
    const sources = extractSessionSources([
      { id: "u1", text: "", images: [inline] },
      { id: "u2", text: "", images: [inline] },
    ]);

    expect(sources).toEqual([
      { kind: "image", key: "image:u2:0", ref: inline, fileName: null },
      { kind: "image", key: "image:u1:0", ref: inline, fileName: null },
    ]);
  });

  it("ignores non-web references, credentials, and URLs inside other words", () => {
    const sources = extractSessionSources([
      {
        id: "u1",
        text: [
          "notes.md [file:/Users/me/notes.md]",
          "ftp://example.com/file",
          "https://user:secret@example.com/private",
          "(https://example.com/wrapped)",
          "see-https://example.com/joined",
        ].join(" "),
      },
    ]);

    expect(sources).toEqual([]);
  });

  it("does not count session references as web links", () => {
    const sources = extractSessionSources([
      {
        id: "u1",
        text: "Earlier-work [session:sde-12345678-1234-1234-1234-123456789abc]",
      },
    ]);

    expect(sources).toEqual([]);
  });
});
