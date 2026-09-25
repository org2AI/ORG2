import { describe, expect, it } from "vitest";

import { extractSessionSources } from "./extractSessionSources";

describe("extractSessionSources", () => {
  it("lists sources newest message first with honest provision provenance", () => {
    const sources = extractSessionSources([
      {
        id: "u1",
        text: "look at https://example.com/docs.",
        images: ["/tmp/abc.png"],
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
        messageId: "u2",
        origin: "provided-link",
      },
      {
        kind: "image",
        key: "image:/tmp/abc.png",
        ref: "/tmp/abc.png",
        fileName: "abc.png",
        messageId: "u1",
        origin: "attachment",
      },
      {
        kind: "link",
        key: "link:https://example.com/docs",
        url: "https://example.com/docs",
        label: "example.com/docs",
        messageId: "u1",
        origin: "provided-link",
      },
    ]);
  });

  it("keeps a repeated source at its most recent position and message", () => {
    const sources = extractSessionSources([
      { id: "u1", text: "https://example.com/a/", images: ["/tmp/shot.png"] },
      { id: "u2", text: "again https://example.com/a#intro" },
      { id: "u3", text: "", images: ["/tmp/shot.png"] },
    ]);
    expect(sources.map(({ key, messageId }) => [key, messageId])).toEqual([
      ["image:/tmp/shot.png", "u3"],
      ["link:https://example.com/a", "u2"],
    ]);
  });

  it("projects Codex attachment envelopes, explicit files and folders without duplicating images", () => {
    const shot = "/var/folders/T/Screenshot with spaces.png";
    const sources = extractSessionSources([
      {
        id: "codex",
        text: [
          "# Files mentioned by the user:",
          "",
          `## Screenshot with spaces.png: ${shot}`,
          "## notes.md: /tmp/notes.md",
          "## docs: /tmp/docs/",
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
        fileName: "Screenshot with spaces.png",
        messageId: "codex",
      }),
      {
        kind: "file",
        key: "file:/tmp/notes.md",
        path: "/tmp/notes.md",
        fileName: "notes.md",
        isDirectory: false,
        messageId: "codex",
        origin: "provided-file",
      },
      {
        kind: "file",
        key: "file:/tmp/docs/",
        path: "/tmp/docs/",
        fileName: "docs",
        isDirectory: true,
        messageId: "codex",
        origin: "provided-file",
      },
      expect.objectContaining({
        kind: "link",
        url: "https://github.com/org2AI/ORG2/pull/602",
        label: "org2AI/ORG2#602",
      }),
    ]);
  });

  it("recognizes persisted file pills and Markdown references but never plain path mentions", () => {
    const sources = extractSessionSources([
      {
        id: "u1",
        text: "review /tmp/secret.md and src/config.ts\n[Plan](./docs/plan.md)\nnotes [file:/tmp/notes.md]",
      },
      { id: "u2", text: "[Notes](/tmp/notes.md)" },
    ]);
    expect(sources.map(({ key, messageId }) => [key, messageId])).toEqual([
      ["file:/tmp/notes.md", "u2"],
      ["file:./docs/plan.md", "u1"],
    ]);
  });

  it("gives inline images a per-message identity and no file name", () => {
    const inline = "data:image/png;base64,AAAA";
    const sources = extractSessionSources([
      { id: "u1", text: "", images: [inline] },
      { id: "u2", text: "", images: [inline] },
    ]);
    expect(sources).toEqual([
      {
        kind: "image",
        key: "image:u2:0",
        ref: inline,
        fileName: null,
        messageId: "u2",
        origin: "attachment",
      },
      {
        kind: "image",
        key: "image:u1:0",
        ref: inline,
        fileName: null,
        messageId: "u1",
        origin: "attachment",
      },
    ]);
  });

  it("ignores credentials, non-web text, session references and generated context", () => {
    expect(
      extractSessionSources([
        {
          id: "u1",
          text: [
            "<in-app-browser-context>https://ambient.dev/</in-app-browser-context>",
            "ftp://example.com/file",
            "https://user:secret@example.com/private",
            "(https://example.com/wrapped)",
            "see-https://example.com/joined",
            "Earlier-work [session:sde-12345678-1234-1234-1234-123456789abc]",
          ].join("\n"),
        },
      ])
    ).toEqual([]);
  });
  it("includes assistant PRs, titled documents and local image references with honest provenance", () => {
    const sources = extractSessionSources([
      { id: "user", text: "please review", images: ["/tmp/input.png"] },
      {
        id: "assistant",
        role: "assistant",
        text: "PR: [fix(chat): stabilize actions](https://github.com/org/repo/pull/42)\n[Implementation report](/tmp/implementation.md)\n![Screenshot](/tmp/preview.png)",
      },
    ]);
    expect(sources).toEqual([
      expect.objectContaining({
        kind: "link",
        label: "fix(chat): stabilize actions",
        url: "https://github.com/org/repo/pull/42",
        origin: "assistant-reference",
        messageId: "assistant",
      }),
      expect.objectContaining({
        kind: "file",
        path: "/tmp/implementation.md",
        title: "Implementation report",
        fileName: "implementation.md",
        origin: "assistant-reference",
      }),
      expect.objectContaining({
        kind: "image",
        ref: "/tmp/preview.png",
        origin: "assistant-reference",
      }),
      expect.objectContaining({
        kind: "image",
        ref: "/tmp/input.png",
        origin: "attachment",
      }),
    ]);
    expect(sources.filter((source) => source.kind !== "image")).toHaveLength(2);
  });

  it("includes explicit structured tool references and names their origin without claiming generation", () => {
    expect(
      extractSessionSources([
        {
          id: "tool-1",
          role: "tool",
          toolName: "read_file",
          text: "report.md [file:/tmp/report.md]",
        },
        {
          id: "tool-2",
          role: "tool",
          toolName: "web_search",
          text: "resource [link:https://example.com/result]",
        },
      ])
    ).toEqual([
      expect.objectContaining({
        kind: "link",
        url: "https://example.com/result",
        origin: "tool-result",
        toolName: "web_search",
      }),
      expect.objectContaining({
        kind: "file",
        path: "/tmp/report.md",
        origin: "tool-result",
        toolName: "read_file",
      }),
    ]);
  });

  it("deduplicates across roles while retaining distinct provenance and latest assistant title", () => {
    const sources = extractSessionSources([
      { id: "u", text: "https://github.com/org/repo/pull/42" },
      {
        id: "t",
        role: "tool",
        toolName: "github",
        text: "resource [link:https://github.com/org/repo/pull/42]",
      },
      {
        id: "a",
        role: "assistant",
        text: "[Fix source navigation](https://github.com/org/repo/pull/42)",
      },
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      label: "Fix source navigation",
      messageId: "a",
      origin: "assistant-reference",
      origins: ["assistant-reference", "tool-result", "provided-link"],
    });
  });

  it("does not treat assistant code examples, free-form paths or shell transcripts as offered files", () => {
    expect(
      extractSessionSources([
        {
          id: "a",
          role: "assistant",
          text: "Mention /tmp/not-offered.txt.\n`https://inline.example`\n```sh\ncurl https://example-code.dev\necho '[file](/tmp/example.txt)'\n```",
        },
      ])
    ).toEqual([]);
  });
  it("accepts the backend's bare structured tool pills including relative paths", () => {
    expect(
      extractSessionSources([
        {
          id: "tool",
          role: "tool",
          toolName: "read_file",
          text: "[file:src/main.ts]\n[link:https://example.com/result]",
        },
      ])
    ).toEqual([
      expect.objectContaining({
        kind: "file",
        path: "src/main.ts",
        fileName: "main.ts",
        origin: "tool-result",
        toolName: "read_file",
      }),
      expect.objectContaining({
        kind: "link",
        url: "https://example.com/result",
        origin: "tool-result",
      }),
    ]);
  });
  it("groups tool activity including failures and deduplicates stable call ids without fake resources", () => {
    const sources = extractSessionSources([
      {
        id: "old",
        role: "tool",
        text: "[file:/tmp/stale.md]",
        toolActivity: {
          callId: "same",
          toolName: "web.search",
          group: "web",
          status: "success",
          actions: [{ kind: "search", query: "old query" }],
        },
      },
      {
        id: "terminal",
        role: "tool",
        text: "",
        toolActivity: {
          callId: "terminal",
          toolName: "read_thread_terminal",
          group: "codex-app",
          status: "success",
          actions: [{ kind: "read-terminal" }],
        },
      },
      {
        id: "failed",
        role: "tool",
        text: "[file:/tmp/never-created.md]",
        images: ["/tmp/never-created.png"],
        toolActivity: {
          callId: "same",
          toolName: "web.search",
          group: "web",
          status: "error",
          error: "No results found",
          actions: [{ kind: "search", query: "latest query" }],
        },
      },
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      kind: "tool-group",
      group: "web",
      operations: [
        {
          callId: "same",
          status: "error",
          error: "No results found",
          actions: [{ kind: "search", query: "latest query" }],
        },
      ],
    });
    expect(sources[1]).toMatchObject({
      kind: "tool-group",
      group: "codex-app",
    });
    expect(sources.every((source) => source.kind === "tool-group")).toBe(true);
  });

  it("keeps successful referenced resources alongside their tool activity group", () => {
    const sources = extractSessionSources([
      {
        id: "tool",
        role: "tool",
        text: "[link:https://example.com]",
        toolActivity: {
          callId: "open",
          toolName: "web.open",
          group: "web",
          status: "success",
          actions: [{ kind: "open", url: "https://example.com" }],
        },
      },
    ]);
    expect(sources.map((source) => source.kind)).toEqual([
      "tool-group",
      "link",
    ]);
  });
});
