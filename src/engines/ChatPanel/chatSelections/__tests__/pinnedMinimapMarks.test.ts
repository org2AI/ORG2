import { describe, expect, it } from "vitest";

import { resolvePinnedMinimapMarks } from "../pinnedMinimapMarks";
import type { PinnedChatSelection } from "../pinnedSelections";

function pin(id: string, text: string, anchorId?: string): PinnedChatSelection {
  return { id, text, anchorId, createdAt: 1 };
}

const RENDER_KEYS = ["chat-turn:a", "chat-turn:b", "chat-turn:c"];

describe("resolvePinnedMinimapMarks", () => {
  it("places a pin on the group its anchor belongs to", () => {
    expect(
      resolvePinnedMinimapMarks([pin("1", "text", "chat-turn:b")], RENDER_KEYS)
    ).toEqual([{ id: "1", label: "text", text: "text", groupIndex: 1 }]);
  });

  it("orders marks down the transcript, not newest-first", () => {
    const marks = resolvePinnedMinimapMarks(
      [
        pin("newest", "third", "chat-turn:c"),
        pin("older", "first", "chat-turn:a"),
      ],
      RENDER_KEYS
    );
    expect(marks.map((mark) => mark.id)).toEqual(["older", "newest"]);
  });

  it("keeps a pin whose turn is not in this projection, unplaceable", () => {
    const marks = resolvePinnedMinimapMarks(
      [
        pin("gone", "old passage", "chat-turn:z"),
        pin("here", "x", "chat-turn:a"),
      ],
      RENDER_KEYS
    );
    expect(marks.map((mark) => [mark.id, mark.groupIndex])).toEqual([
      ["here", 0],
      ["gone", null],
    ]);
  });

  it("treats an anchorless pin as unplaceable", () => {
    expect(
      resolvePinnedMinimapMarks([pin("1", "text")], RENDER_KEYS)[0].groupIndex
    ).toBeNull();
  });

  it("collapses a multi-line passage into the mark label", () => {
    expect(
      resolvePinnedMinimapMarks(
        [pin("1", "one\ntwo", "chat-turn:a")],
        RENDER_KEYS
      )[0].label
    ).toBe("one two");
  });
});
