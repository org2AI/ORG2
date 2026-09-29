import { describe, expect, it } from "vitest";

import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { sortSessionSources } from "./sortSessionSources";

const sources: SessionSource[] = [
  {
    kind: "image",
    key: "latest",
    ref: "/tmp/latest.png",
    fileName: "latest.png",
    origin: "tool-result",
  },
  {
    kind: "image",
    key: "provided",
    ref: "/tmp/provided.png",
    fileName: "provided.png",
    origin: "assistant-reference",
    origins: ["assistant-reference", "attachment"],
  },
  {
    kind: "image",
    key: "earliest",
    ref: "/tmp/earliest.png",
    fileName: "earliest.png",
    origin: "tool-result",
  },
];

describe("sortSessionSources", () => {
  it("keeps extracted recency by default and reverses it for oldest first", () => {
    expect(
      sortSessionSources(sources, "newest").map((source) => source.key)
    ).toEqual(["latest", "provided", "earliest"]);
    expect(
      sortSessionSources(sources, "oldest").map((source) => source.key)
    ).toEqual(["earliest", "provided", "latest"]);
    expect(sources.map((source) => source.key)).toEqual([
      "latest",
      "provided",
      "earliest",
    ]);
  });

  it("recognizes any retained user provenance without changing order inside buckets", () => {
    expect(
      sortSessionSources(sources, "provided-first").map((source) => source.key)
    ).toEqual(["provided", "latest", "earliest"]);
  });
});
