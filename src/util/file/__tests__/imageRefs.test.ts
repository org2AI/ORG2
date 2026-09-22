import { describe, expect, it } from "vitest";

import {
  imageRefToRustPath,
  isDirectImageUrl,
  parseTranscriptImageRef,
} from "../imageRefs";

describe("imageRefToRustPath", () => {
  it.each([
    ["asset://localhost/tmp/Screenshot%202026.png", "/tmp/Screenshot 2026.png"],
    [
      "https://asset.localhost/tmp/Screenshot%202026.png",
      "/tmp/Screenshot 2026.png",
    ],
    ["http://asset.localhost/C%3A/Users/me/image.png", "C:/Users/me/image.png"],
  ])("decodes Tauri asset reference %s", (reference, expected) => {
    expect(imageRefToRustPath(reference)).toBe(expected);
  });

  it("leaves data URLs and plain paths unchanged", () => {
    expect(imageRefToRustPath("data:image/png;base64,c21hbGw=")).toBe(
      "data:image/png;base64,c21hbGw="
    );
    expect(imageRefToRustPath("/tmp/image.png")).toBe("/tmp/image.png");
  });

  it("leaves malformed asset URLs unchanged", () => {
    const malformedRef = "asset://localhost/tmp/bad%2";
    expect(imageRefToRustPath(malformedRef)).toBe(malformedRef);
  });
});

describe("isDirectImageUrl", () => {
  it.each([
    ["data:image/png;base64,ABC", true],
    ["blob:preview", true],
    ["https://example.com/shot.png", true],
    ["http://example.com/shot.png", true],
    ["https://asset.localhost/tmp/shot.png", false],
    ["asset://localhost/tmp/shot.png", false],
    ["/tmp/shot.png", false],
    ["C:\\Users\\shot.png", false],
  ])("classifies %s", (ref, expected) => {
    expect(isDirectImageUrl(ref)).toBe(expected);
  });
});

it("decodes source-backed image references without treating them as filesystem URLs", () => {
  const ref =
    'orgii-transcript-image:["codexapp-one","codex-user-123","/tmp/shot.png"]';
  expect(parseTranscriptImageRef(ref)).toEqual({
    sessionId: "codexapp-one",
    turnId: "codex-user-123",
    originalRef: "/tmp/shot.png",
  });
  expect(imageRefToRustPath(ref)).toBe("/tmp/shot.png");
  expect(isDirectImageUrl(ref)).toBe(false);
  expect(parseTranscriptImageRef("orgii-transcript-image:[1]")).toBeNull();
});
