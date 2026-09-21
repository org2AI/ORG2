import { describe, expect, it } from "vitest";

import {
  MOBILE_DRAFT_IMAGE_BUDGET,
  MOBILE_DRAFT_LIMIT,
  MOBILE_DRAFT_TEXT_LIMIT,
  createMobileComposerDraftStore,
} from "./mobileComposerDraftStore";

describe("navigation draft ownership", () => {
  it("isolates desktop/session, revokes only one desktop and rejects its late completion", () => {
    const store = createMobileComposerDraftStore();
    const one = store.scope(JSON.stringify(["one", "session"]));
    const two = store.scope(JSON.stringify(["two", "session"]));
    one.update((draft) => ({ ...draft, text: "one" }));
    two.update((draft) => ({ ...draft, text: "two" }));
    const old = one.capture();
    store.clearDesktop("one");
    one.update((draft) => ({ ...draft, text: "new pairing" }));
    one.updateIfCurrent(old, (draft) => ({ ...draft, text: "stale" }));
    expect(one.getSnapshot().text).toBe("new pairing");
    expect(two.getSnapshot().text).toBe("two");
    store.clear();
    expect(two.getSnapshot().text).toBe("");
  });

  it("bounds inactive entries and protects the subscribed composer", () => {
    const store = createMobileComposerDraftStore();
    const active = store.scope("active");
    const unsub = active.subscribe(() => undefined);
    active.update((draft) => ({ ...draft, text: "typing" }));
    for (let index = 0; index < MOBILE_DRAFT_LIMIT + 5; index++) {
      store
        .scope(String(index))
        .update((draft) => ({ ...draft, text: String(index) }));
    }
    expect(active.getSnapshot().text).toBe("typing");
    expect(store.scope("0").getSnapshot().text).toBe("");
    expect(store.scope("24").getSnapshot().text).toBe("24");
    unsub();
  });

  it("enforces text and aggregate image bounds without truncating active data", () => {
    const store = createMobileComposerDraftStore();
    const one = store.scope("one");
    one.update((draft) => ({ ...draft, text: "keep" }));
    expect(() =>
      one.update((draft) => ({
        ...draft,
        text: "x".repeat(MOBILE_DRAFT_TEXT_LIMIT + 1),
      }))
    ).toThrow(RangeError);
    expect(one.getSnapshot().text).toBe("keep");
    const image = {
      id: "image",
      fileName: "",
      dataUrl: "x".repeat(MOBILE_DRAFT_IMAGE_BUDGET / 4 + 1),
    };
    one.update((draft) => ({ ...draft, images: [image] }));
    const two = store.scope("two");
    two.update((draft) => ({ ...draft, images: [image] }));
    expect(one.getSnapshot().images).toHaveLength(0);
    expect(two.getSnapshot().images).toHaveLength(1);
    const unsub = two.subscribe(() => undefined);
    expect(() =>
      one.update((draft) => ({ ...draft, images: [image] }))
    ).toThrow(RangeError);
    expect(two.getSnapshot().images).toHaveLength(1);
    unsub();
  });
});
