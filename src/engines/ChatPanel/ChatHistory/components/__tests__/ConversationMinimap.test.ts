import { describe, expect, it } from "vitest";

import {
  CONVERSATION_MINIMAP_FLUSH_CONTAINER_PX,
  CONVERSATION_PREVIEW_POSITION_CLASS,
  findNearestConversationMarker,
  getConversationMarkerWidthClass,
  getConversationMinimapPlacementClasses,
  getNavigableConversationGroupIndices,
  hasConversationMinimapRail,
  resolveActiveConversationMarker,
  resolveConversationMinimapVisibilityClass,
  resolveHighlightedConversationMarkers,
  sampleConversationGroupIndices,
} from "../ConversationMinimap";

describe("getConversationMinimapPlacementClasses", () => {
  it("places fullscreen on the left and split chat on the right at either width", () => {
    const full = getConversationMinimapPlacementClasses(true);
    const side = getConversationMinimapPlacementClasses(false);
    expect(full.nav).toContain("left-3");
    expect(full.nav).toContain(
      `@[${CONVERSATION_MINIMAP_FLUSH_CONTAINER_PX}px]/chatbody:left-0`
    );
    expect(full.nav).not.toContain("right-");
    expect(side.nav).toContain("right-3");
    expect(side.nav).toContain("@[960px]/chatbody:right-0");
    expect(side.nav).not.toContain("left-");
    expect(full.markerButton).toContain("justify-start");
    expect(side.markerButton).toContain("justify-end");
  });
  it("opens both turn and pinned previews inward", () => {
    const full = getConversationMinimapPlacementClasses(true);
    const side = getConversationMinimapPlacementClasses(false);
    expect(full.preview).toContain("left-full");
    expect(full.pinPreview).toContain("left-full");
    expect(side.preview).toBe(CONVERSATION_PREVIEW_POSITION_CLASS);
    expect(side.preview).toContain("right-full");
    expect(side.pinPreview).toContain("right-full");
  });
});
describe("resolveConversationMinimapVisibilityClass", () => {
  it("preserves the same body-width and interaction visibility rules", () => {
    expect(
      resolveConversationMinimapVisibilityClass({ showFloatingMinimap: true })
    ).toBe("flex");
    expect(
      resolveConversationMinimapVisibilityClass({ showFloatingMinimap: false })
    ).toBe("hidden @[640px]/chatbody:flex");
  });
});

describe("resolveHighlightedConversationMarkers", () => {
  it("maps every visible round to its nearest sampled marker", () => {
    expect(
      resolveHighlightedConversationMarkers(
        [0, 5, 10, 15],
        [4, 6, 11],
        4,
        false
      )
    ).toEqual([5, 10]);
  });

  it("always includes the final marker at the content bottom", () => {
    expect(
      resolveHighlightedConversationMarkers([0, 5, 10], [5], 5, true)
    ).toEqual([5, 10]);
  });
});

describe("getConversationMarkerWidthClass", () => {
  it("fans seven handles to 8, 12, 16, 20, 16, 12, 8 pixels", () => {
    expect(
      Array.from({ length: 7 }, (_, markerIndex) =>
        getConversationMarkerWidthClass(markerIndex, 3)
      )
    ).toEqual(["w-2", "w-3", "w-4", "w-5", "w-4", "w-3", "w-2"]);
  });

  it("keeps resting handles at eight pixels", () => {
    expect(getConversationMarkerWidthClass(3, -1)).toBe("w-2");
  });
});

describe("hasConversationMinimapRail", () => {
  it("counts logical turns without promoting a retry audit group to a turn", () => {
    const headers = [{}, null, {}, {}, {}];
    const counts = [1, 1, 1, 1, 1];
    expect(
      getNavigableConversationGroupIndices(headers, counts, [
        {},
        { retryAudit: true },
        {},
        {},
        {},
      ])
    ).toEqual([0, 2, 3, 4]);
    expect(getNavigableConversationGroupIndices(headers, counts)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(
      hasConversationMinimapRail([{}, null], [1, 1], [{}, { retryAudit: true }])
    ).toBe(false);
  });
  it("shows the rail once two rounds are navigable", () => {
    expect(hasConversationMinimapRail([{}, {}], [1, 1])).toBe(true);
  });

  it("keeps the rail hidden for empty and single-round conversations", () => {
    expect(hasConversationMinimapRail([], [])).toBe(false);
    expect(hasConversationMinimapRail([{}], [3])).toBe(false);
  });

  it("ignores fully empty groups when counting navigable rounds", () => {
    expect(hasConversationMinimapRail([{}, null], [2, 0])).toBe(false);
  });
});

describe("getNavigableConversationGroupIndices", () => {
  it("keeps non-empty headerless rounds and skips fully empty groups", () => {
    expect(
      getNavigableConversationGroupIndices([null, null, null], [2, 1, 0])
    ).toEqual([0, 1]);
  });

  it("keeps a user-only round even when it has no body items", () => {
    expect(getNavigableConversationGroupIndices([{}, {}], [1, 0])).toEqual([
      0, 1,
    ]);
  });
});

describe("sampleConversationGroupIndices", () => {
  it("keeps every turn when the conversation fits within the marker cap", () => {
    expect(sampleConversationGroupIndices([1, 2, 4, 7])).toEqual([1, 2, 4, 7]);
  });

  it("samples long conversations by percentage and retains both ends", () => {
    const groupIndices = Array.from({ length: 101 }, (_, index) => index);
    const sampled = sampleConversationGroupIndices(groupIndices, 20);

    expect(sampled).toHaveLength(20);
    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBe(100);
    expect(new Set(sampled).size).toBe(20);
    expect(sampled[10]).toBeGreaterThanOrEqual(50);
    expect(sampled[10]).toBeLessThanOrEqual(55);
  });

  it("returns the final turn when only one marker is requested", () => {
    expect(sampleConversationGroupIndices([2, 8, 13], 1)).toEqual([13]);
  });
});

describe("findNearestConversationMarker", () => {
  it("maps an unsampled active turn to its nearest percentage marker", () => {
    expect(findNearestConversationMarker([0, 5, 10, 15], 8)).toBe(10);
  });

  it("returns null when no markers are available", () => {
    expect(findNearestConversationMarker([], 3)).toBeNull();
  });
});

describe("resolveActiveConversationMarker", () => {
  it("selects the final sampled round at the content bottom", () => {
    expect(resolveActiveConversationMarker([0, 5, 10, 15], 10, true)).toBe(15);
  });

  it("uses the nearest sampled round away from the content bottom", () => {
    expect(resolveActiveConversationMarker([0, 5, 10, 15], 8, false)).toBe(10);
  });
});
