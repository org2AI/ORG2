import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MIN_TIME_RANGE_MS,
  formatClockRange,
  formatClockTime,
} from "../formatClockTime";

// `config/vitest.config.ts` pins TZ to America/Los_Angeles, so 16:30Z is
// 09:30 local (PDT) regardless of the developer's own zone.
const START_MS = Date.UTC(2026, 6, 13, 16, 30, 0);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatClockTime", () => {
  it("formats a timestamp as a zero-padded 24-hour HH:MM label", () => {
    expect(formatClockTime(START_MS)).toBe("09:30");
  });

  it("returns an empty label for non-finite input", () => {
    expect(formatClockTime(Number.NaN)).toBe("");
    expect(formatClockTime(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("returns an empty label when Intl formatting throws", () => {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(() => {
      throw new RangeError("Invalid time zone");
    });
    expect(formatClockTime(START_MS)).toBe("");
  });
});

describe("formatClockRange", () => {
  it("collapses endpoints closer than MIN_TIME_RANGE_MS to a single label", () => {
    expect(formatClockRange(START_MS, START_MS + MIN_TIME_RANGE_MS - 1)).toBe(
      "09:30"
    );
  });

  it("renders a start ~ end range once the endpoints are a minute apart", () => {
    expect(formatClockRange(START_MS, START_MS + MIN_TIME_RANGE_MS)).toBe(
      "09:30 ~ 09:31"
    );
  });

  it("returns an empty label when either endpoint cannot be formatted", () => {
    expect(formatClockRange(Number.NaN, START_MS)).toBe("");
    expect(formatClockRange(START_MS, Number.NaN)).toBe("");
  });
});
