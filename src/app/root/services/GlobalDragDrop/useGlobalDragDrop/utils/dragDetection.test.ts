import { afterEach, describe, expect, it } from "vitest";

import { reorderActiveRef } from "@src/store/ui/queueReorderState";

import { isInternalDrag } from "./dragDetection";

afterEach(() => {
  reorderActiveRef.current = false;
});

describe("queue reorder drag coordination", () => {
  it("uses the shared queue flag even without native drag metadata", () => {
    const event = new Event("dragover");
    reorderActiveRef.current = true;
    expect(isInternalDrag(event)).toBe(true);
    reorderActiveRef.current = false;
    expect(isInternalDrag(event)).toBe(false);
  });
});
