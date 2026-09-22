import { expect, it } from "vitest";

import { marketProfileLabel } from "./profileLabels";

it("distinguishes separate packages with the same title without displaying ids", () => {
  const profiles = [
    { id: "market:private-user:purchase-b", label: "Claude Package" },
    { id: "market:private-user:purchase-a", label: "Claude Package" },
  ];
  expect(
    profiles.map((profile) => marketProfileLabel(profile, profiles))
  ).toEqual(["Claude Package · 2/2", "Claude Package · 1/2"]);
  expect(marketProfileLabel(profiles[0], [...profiles].reverse())).toBe(
    "Claude Package · 2/2"
  );
});

it("preserves distinct titles and does not count repeated reads of one purchase", () => {
  const a = { id: "purchase-a", label: "Claude Package" };
  const b = { id: "purchase-b", label: "Codex Package" };
  expect(marketProfileLabel(a, [a, a, b])).toBe("Claude Package");
  expect(marketProfileLabel(b, [a, b])).toBe("Codex Package");
});
