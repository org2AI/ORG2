import { describe, expect, it, vi } from "vitest";

import type { KeyInfo } from "@src/api/services/keyValidation";

import {
  subscribeWeeklyQuotaAccountChanges,
  weeklyQuotaAccountSignature,
} from "./weeklyQuotaAccounts";

const mocks = vi.hoisted(() => ({
  keys: [] as unknown[],
  listener: undefined as ((keys: unknown[]) => void) | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock("./sharedLocalKeyStore", () => ({
  getSharedLocalKeys: () => mocks.keys,
  subscribeSharedLocalKeys: (listener: (keys: unknown[]) => void) => {
    mocks.listener = listener;
    return mocks.unsubscribe;
  },
}));
const key = (extra: Partial<KeyInfo> = {}) =>
  ({
    id: "one",
    agent_type: "codex",
    enabled: true,
    account_metadata: {},
    ...extra,
  }) as KeyInfo;
describe("weekly quota account notifications", () => {
  it("ignores repeated health/quota updates and emits identity changes", () => {
    const initial = key();
    mocks.keys = [initial];
    const changed = vi.fn();
    const stop = subscribeWeeklyQuotaAccountChanges(changed);
    for (let i = 0; i < 100; i++)
      mocks.listener?.([
        {
          ...initial,
          quota_info: { remaining_percentage: i },
          updated_at: String(i),
        },
      ]);
    expect(changed).not.toHaveBeenCalled();
    mocks.listener?.([key({ enabled: false })]);
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });
  it("ignores account order but includes credentials and endpoints", () => {
    const a = key(),
      b = key({ id: "two" });
    expect(weeklyQuotaAccountSignature([a, b])).toBe(
      weeklyQuotaAccountSignature([b, a])
    );
    expect(weeklyQuotaAccountSignature([a])).not.toBe(
      weeklyQuotaAccountSignature([key({ base_url: "https://other.test" })])
    );
    expect(weeklyQuotaAccountSignature([a])).not.toBe(
      weeklyQuotaAccountSignature([key({ session_token_preview: "changed" })])
    );
  });
  it("ignores serialization order of masked environment maps", () => {
    expect(
      weeklyQuotaAccountSignature([
        key({ env_vars_masked: { A: "***", B: "***" } }),
      ])
    ).toBe(
      weeklyQuotaAccountSignature([
        key({ env_vars_masked: { B: "***", A: "***" } }),
      ])
    );
  });
});
