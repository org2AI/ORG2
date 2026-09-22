import { describe, expect, it } from "vitest";

import { outputImages, textOnlyOutputResult } from "./outputImages";

describe("model output images", () => {
  it("renders canonical lazy references without decoding their bytes", () => {
    const ref =
      'orgii-transcript-image:["s","codex-output-image:123","identity"]';
    expect(outputImages({ images: [ref, ref] })).toEqual([ref]);
  });
  it("accepts Codex, MCP, and Anthropic content blocks", () => {
    expect(
      outputImages({
        content: [
          { type: "input_image", image_url: "data:image/png;base64,CODEX" },
          { type: "image", mimeType: "image/png", data: "MCP" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "CLAUDE",
            },
          },
          {
            type: "image_url",
            image_url: { url: "https://example.com/a.png" },
          },
        ],
      })
    ).toEqual([
      "data:image/png;base64,CODEX",
      "data:image/png;base64,MCP",
      "data:image/jpeg;base64,CLAUDE",
      "https://example.com/a.png",
    ]);
  });
  it("does not interpret prose, arguments, or unsupported URI schemes as images", () => {
    expect(
      outputImages({
        images: ["javascript:alert(1)"],
        content: [{ type: "text", text: "/tmp/a.png" }],
        args: { image_url: "/tmp/b.png" },
      })
    ).toEqual([]);
  });
});

it("keeps media bytes out of tool text without changing stored results", () => {
  const result = {
    images: ["data:image/png;base64,AAAA"],
    content: [
      { type: "image", data: "BYTES", mimeType: "image/png" },
      { type: "text", text: "Caption" },
    ],
    success: true,
  };
  expect(textOnlyOutputResult(result)).toEqual({
    content: [{ type: "text", text: "Caption" }],
    success: true,
  });
  expect(result.images).toHaveLength(1);
  expect(result.content).toHaveLength(2);
});
