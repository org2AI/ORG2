import { describe, expect, it } from "vitest";

import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";

import { mergeRestoredImageAttachments } from "../restoreInputImages";

function image(id: string, ownerId: string): ChatImageAttachment {
  return {
    id,
    ownerId,
    dataUrl: `data:image/png;base64,${id}`,
    fileName: `${id}.png`,
    size: 1,
    width: 1,
    height: 1,
  };
}

describe("mergeRestoredImageAttachments", () => {
  it("appends a rejected request's images without overwriting newer images", () => {
    const current = image("current", "composer-a");
    const recovered = image("recovered", "composer-a");

    expect(
      mergeRestoredImageAttachments({
        existing: [current],
        restored: [recovered],
        ownerId: "composer-a",
        append: true,
      })
    ).toEqual([current, recovered]);
  });

  it("keeps the existing stop-restore replacement behavior", () => {
    const previous = image("previous", "composer-a");
    const otherComposer = image("other", "composer-b");
    const restored = image("restored", "composer-a");

    expect(
      mergeRestoredImageAttachments({
        existing: [previous, otherComposer],
        restored: [restored],
        ownerId: "composer-a",
        append: false,
      })
    ).toEqual([otherComposer, restored]);
  });
});
