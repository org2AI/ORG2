import { describe, expect, it, vi } from "vitest";

import type { ComposerSnapshot } from "@src/components/ComposerInput";

import { resolveChannelMentionedUserIds } from "./channelMentions";
import { createCloudChannelPostHandler } from "./channelPostHandler";

const members = [
  { userId: "self", displayName: "Me" },
  { userId: "one", displayName: "Same Name" },
  { userId: "two", displayName: "Same Name" },
];
function pill(filePath: string): ComposerSnapshot {
  return {
    parts: [
      {
        kind: "pill",
        attrs: {
          filePath,
          fileName: "Same Name",
          iconType: "member",
          isFolder: false,
          lineStart: null,
          lineEnd: null,
        },
      },
    ],
  };
}

describe("channel submission audience", () => {
  it("sends the selected identity through the post boundary despite duplicate labels", async () => {
    const post = vi.fn(async () => undefined);
    const handler = createCloudChannelPostHandler({
      post,
      translate: (key) => key,
      onError: vi.fn(),
      resolveMentions: (input) =>
        resolveChannelMentionedUserIds(input, members, "self"),
    });
    await expect(
      handler({
        displayText: "@Same Name",
        composerSnapshot: pill("member://two"),
      })
    ).resolves.toBe(true);
    expect(post).toHaveBeenCalledExactlyOnceWith("@Same Name", ["two"]);
  });
  it.each(["email name@example.com", "a bare @ marker"])(
    "keeps ordinary %s sendable while the roster is unavailable",
    (displayText) => {
      expect(
        resolveChannelMentionedUserIds({ displayText }, null, "self")
      ).toEqual([]);
    }
  );

  it("resolves all only to the readable roster and excludes the sender", () => {
    expect(
      resolveChannelMentionedUserIds({ displayText: "@all" }, members, "self")
    ).toEqual(["one", "two"]);
  });
  it("allows ordinary messages without a roster but refuses uncertain mentions", () => {
    expect(
      resolveChannelMentionedUserIds({ displayText: "hello" }, null, "self")
    ).toEqual([]);
    expect(() =>
      resolveChannelMentionedUserIds({ displayText: "@all" }, null, "self")
    ).toThrow("unavailable");
  });
  it.each(["member://removed", "agent://one"])(
    "rejects %s before writing instead of dropping its identity",
    async (path) => {
      const post = vi.fn(async () => undefined);
      const handler = createCloudChannelPostHandler({
        post,
        translate: (key) => key,
        onError: vi.fn(),
        resolveMentions: (input) =>
          resolveChannelMentionedUserIds(input, members, "self"),
      });
      await expect(
        handler({ displayText: "@Same Name", composerSnapshot: pill(path) })
      ).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
    }
  );
  it("rejects all above the server recipient cap", () => {
    const roster = Array.from({ length: 51 }, (_, i) => ({
      userId: String(i),
    }));
    expect(() =>
      resolveChannelMentionedUserIds({ displayText: "@all" }, roster, "self")
    ).toThrow("limit");
  });
});
