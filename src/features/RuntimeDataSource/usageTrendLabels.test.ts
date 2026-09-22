import { describe, expect, it } from "vitest";

import { formatBucketLabel } from "./UsageTrendChart";

/**
 * Day-bucket labels must name the bucket's own UTC day.
 *
 * Trend buckets are UTC calendar days (`TrendBucket::Day` floors on UTC, and
 * a teammate's `MemberUsageDay.day` is a UTC date string). Formatting UTC
 * midnight in a negative-offset zone prints the PREVIOUS date, so every bar
 * reads a day early in the Americas and two teammates in different zones
 * disagree about identical data.
 *
 * TZ is pinned to a negative offset before any Date work so this actually
 * fails if the UTC pin is removed — on a UTC runner the bug is invisible.
 */
process.env.TZ = "America/Los_Angeles";

const UTC_MIDNIGHT = Date.parse("2026-07-30T00:00:00Z");

describe("formatBucketLabel", () => {
  it("labels a day bucket by its UTC date, not the viewer's local date", () => {
    expect(formatBucketLabel(UTC_MIDNIGHT, false, "en-US")).toBe("07/30");
  });

  it("does not drift to the previous local calendar day", () => {
    // What the pre-fix code produced under this TZ — the exact bug.
    const localDate = new Date(UTC_MIDNIGHT).toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
    });
    expect(localDate).toBe("07/29");
    expect(formatBucketLabel(UTC_MIDNIGHT, false, "en-US")).not.toBe(localDate);
  });

  it("keeps hour buckets in the viewer's local zone", () => {
    // Hour buckets are plain instants: UTC midnight IS 5PM in Los Angeles,
    // and that is what a viewer wants to read.
    expect(formatBucketLabel(UTC_MIDNIGHT, true, "en-US")).toBe("5PM");
  });
});
