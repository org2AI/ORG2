import { describe, expect, it } from "vitest";

import {
  ACCOUNT_SETUP_METHOD_METADATA_KEY,
  reconnectSetupMethod,
  withRecordedSetupMethod,
} from "./accountSetupMethod";

describe("reconnectSetupMethod", () => {
  const recordedAs = (method: string) => ({
    accountMetadata: { [ACCOUNT_SETUP_METHOD_METADATA_KEY]: method },
  });

  it("reopens the method the account was added with", () => {
    expect(reconnectSetupMethod("codex", recordedAs("autodetect"))).toBe(
      "autodetect"
    );
    expect(reconnectSetupMethod("codex", recordedAs("enter_token"))).toBe(
      "enter_token"
    );
    expect(reconnectSetupMethod("claude_code", recordedAs("autodetect"))).toBe(
      "autodetect"
    );
  });

  it("falls back to sign-in for accounts saved before the method was recorded", () => {
    expect(reconnectSetupMethod("codex", undefined)).toBe("signin");
    expect(reconnectSetupMethod("claude_code", {})).toBe("signin");
    expect(
      reconnectSetupMethod("codex", { accountMetadata: { email: "a@b.c" } })
    ).toBe("signin");
  });

  it("ignores a recorded method the agent does not offer", () => {
    expect(reconnectSetupMethod("codex", recordedAs("guided"))).toBe("signin");
    expect(reconnectSetupMethod("claude_code", recordedAs("enter_token"))).toBe(
      "signin"
    );
  });
});

describe("withRecordedSetupMethod", () => {
  it("adds the chosen method to the detected account metadata", () => {
    expect(
      withRecordedSetupMethod({ email: "a@b.c" }, "autodetect", "signin")
    ).toEqual({
      email: "a@b.c",
      [ACCOUNT_SETUP_METHOD_METADATA_KEY]: "autodetect",
    });
  });

  it("records the step's default when the selector was never touched", () => {
    expect(withRecordedSetupMethod(undefined, undefined, "signin")).toEqual({
      [ACCOUNT_SETUP_METHOD_METADATA_KEY]: "signin",
    });
  });

  it("leaves metadata alone when no method is known", () => {
    expect(withRecordedSetupMethod(undefined, undefined, undefined)).toBe(
      undefined
    );
    expect(withRecordedSetupMethod({}, undefined, undefined)).toBe(undefined);
    expect(
      withRecordedSetupMethod({ email: "a@b.c" }, undefined, undefined)
    ).toEqual({ email: "a@b.c" });
  });
});
