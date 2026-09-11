import { describe, expect, it } from "vitest";

import { markdownUrlTransform } from "@src/components/MarkDown/markdownUrlTransform";
import { parseUserMessage } from "@src/engines/ChatPanel/ChatHistory/components/userMessageSegments";

import {
  buildSharedSessionFileReference,
  parseSharedSessionFileReference,
} from "./sharedSessionFileReference";

const id = "11111111-1111-4111-8111-111111111111";
describe("shared file references", () => {
  it("round trips endpoint identity and only allows the scheme on links", () => {
    const href = buildSharedSessionFileReference(id, "https://cloud.example/");
    expect(parseSharedSessionFileReference(href)).toEqual({
      id,
      endpoint: "https://cloud.example",
    });
    expect(markdownUrlTransform(href, "href")).toBe(href);
    expect(markdownUrlTransform(href, "src")).toBe("");
  });
  it("renders shared links as file references in Team Chat as well as Markdown", () => {
    const href = buildSharedSessionFileReference(id, "https://cloud.example");
    expect(parseUserMessage(`[report.md](${href})`)).toEqual([
      { kind: "pill", displayName: "report.md", pillType: "file", path: href },
    ]);
  });
  it.each([
    "orgii-file://../a",
    "orgii-file://bad?endpoint=x",
    `orgii-file://${id}/extra?endpoint=x`,
    `orgii-file://${id}?endpoint=x&endpoint=y`,
    `orgii-file://${id}?endpoint=x#hash`,
    `https://${id}?endpoint=x`,
  ])("rejects malformed reference %s", (value) => {
    expect(parseSharedSessionFileReference(value)).toBeNull();
  });
});
