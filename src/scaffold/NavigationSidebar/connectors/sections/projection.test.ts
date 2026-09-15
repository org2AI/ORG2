import { describe, expect, it } from "vitest";

import type { Session } from "@src/store/session";

import { buildCustomSectionItems } from "./projection";

const headers = ["a", "empty"].map((id) => ({
  id: `separator-custom-section-${id}`,
  key: id,
  label: id,
}));
const membership = new Map([["session", "a"]]);
const row = (s: Session) => ({
  id: s.session_id,
  key: s.session_id,
  label: s.name ?? "",
});
const render = (pinned: boolean, members = membership) =>
  buildCustomSectionItems(
    [{ session_id: "session", pinned } as Session],
    headers,
    members,
    row,
    () => null
  );
describe("section placement", () => {
  it("retains empty headers and places each assigned session once", () => {
    expect(render(false).map((r) => r.id)).toEqual([
      "separator-custom-section-a",
      "session",
      "separator-custom-section-empty",
    ]);
  });
  it("preserves membership while pinned, then restores the row on unpin", () => {
    expect(render(true).map((r) => r.id)).not.toContain("session");
    expect(membership.get("session")).toBe("a");
    expect(render(false).map((r) => r.id)).toContain("session");
  });
  it("stops grouping a session after membership removal", () => {
    expect(render(false, new Map()).map((r) => r.id)).not.toContain("session");
  });
});
