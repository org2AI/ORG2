import { afterEach, describe, expect, it, vi } from "vitest";

import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import {
  MAX_SHARED_FILE_RETRY_ENTRIES,
  SHARED_FILE_QUOTA_RETRY_MS,
  SHARED_FILE_RETRY_MS,
  SessionSharedFileRetry,
  sharedFileRetryScope,
} from "./sessionSharedFileRetry";
import { SharedSessionFileRequestError } from "./sharedSessionFilesClient";

const auth = {
  userId: "user",
  supabaseUrl: "https://auth.example",
} as Org2CloudAuthState;
const scope = sharedFileRetryScope(
  auth,
  "https://endpoint.example",
  "org",
  "session"
);
const quota = new SharedSessionFileRequestError(
  "quota",
  400,
  false,
  "ORG2_QUOTA_EXCEEDED"
);
afterEach(() => vi.restoreAllMocks());

describe("replay attachment retry lifecycle", () => {
  it("backs off org quota across sessions but isolates users, endpoints and orgs", () => {
    const retry = new SessionSharedFileRetry();
    retry.noteFailure(scope, quota);
    expect(retry.isBackedOff({ ...scope, sessionId: "other" })).toBe(true);
    expect(retry.isBackedOff({ ...scope, orgId: "other" })).toBe(false);
    expect(
      retry.isBackedOff(
        sharedFileRetryScope(
          { ...auth, userId: "other" },
          "https://endpoint.example",
          "org",
          "session"
        )
      )
    ).toBe(false);
    expect(
      retry.isBackedOff(
        sharedFileRetryScope(auth, "https://other.example", "org", "session")
      )
    ).toBe(false);
    // Token refresh preserves the identity boundary.
    expect(
      retry.isBackedOff(
        sharedFileRetryScope(
          { ...auth, accessToken: "refreshed" },
          "https://endpoint.example",
          "org",
          "session"
        )
      )
    ).toBe(true);
  });

  it("bounds transient retries to the failing session and expires them without timers", () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const retry = new SessionSharedFileRetry();
    retry.noteFailure(scope, new Error("offline"));
    expect(retry.isBackedOff(scope)).toBe(true);
    expect(retry.isBackedOff({ ...scope, sessionId: "other" })).toBe(false);
    now = SHARED_FILE_RETRY_MS;
    expect(retry.isBackedOff(scope)).toBe(false);
    retry.noteFailure(scope, quota);
    now += SHARED_FILE_QUOTA_RETRY_MS - 1;
    expect(retry.isBackedOff(scope)).toBe(true);
    now++;
    expect(retry.isBackedOff(scope)).toBe(false);
  });

  it("evicts failures on deletion, org removal and reset", () => {
    const retry = new SessionSharedFileRetry();
    retry.noteFailure(scope, new Error("offline"));
    retry.prune(new Set(["org"]), new Set());
    expect(retry.isBackedOff(scope)).toBe(false);
    retry.noteFailure(scope, quota);
    retry.prune(new Set(), new Set(["session"]));
    expect(retry.isBackedOff(scope)).toBe(false);
    retry.noteFailure(scope, quota);
    retry.reset();
    expect(retry.isBackedOff(scope)).toBe(false);
  });

  it("caps retained entries even if many sessions fail before pruning", () => {
    const retry = new SessionSharedFileRetry();
    for (let index = 0; index <= MAX_SHARED_FILE_RETRY_ENTRIES; index++)
      retry.noteFailure(
        { ...scope, sessionId: String(index) },
        new Error("offline")
      );
    expect(retry.isBackedOff({ ...scope, sessionId: "0" })).toBe(false);
    expect(retry.isBackedOff({ ...scope, sessionId: "1" })).toBe(true);
    expect(
      retry.isBackedOff({
        ...scope,
        sessionId: String(MAX_SHARED_FILE_RETRY_ENTRIES),
      })
    ).toBe(true);
  });
});
