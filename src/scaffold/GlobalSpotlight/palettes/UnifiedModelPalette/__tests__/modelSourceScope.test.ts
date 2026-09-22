import { describe, expect, it } from "vitest";

import { MODEL_SOURCE_SCOPE } from "@src/store/ui/spotlightModelSourceScopeAtom";

import { scopeIncludesMarket, scopeListingSources } from "../modelSourceScope";

const accounts = [{ id: "key-a" }, { id: "key-b" }];
const marketSources = [{ id: "market:one" }];

describe("scopeListingSources", () => {
  it("narrows nothing without a scope — the anchored dropdown's case", () => {
    const scoped = scopeListingSources(accounts, marketSources, undefined);
    expect(scoped.accounts).toBe(accounts);
    expect(scoped.marketSources).toBe(marketSources);
  });

  it("drops Market packages under the keys scope", () => {
    const scoped = scopeListingSources(
      accounts,
      marketSources,
      MODEL_SOURCE_SCOPE.KEYS
    );
    expect(scoped.accounts).toBe(accounts);
    expect(scoped.marketSources).toEqual([]);
  });

  it("drops Key Vault keys under the market scope", () => {
    const scoped = scopeListingSources(
      accounts,
      marketSources,
      MODEL_SOURCE_SCOPE.MARKET
    );
    expect(scoped.accounts).toEqual([]);
    expect(scoped.marketSources).toBe(marketSources);
  });
});

describe("scopeIncludesMarket", () => {
  it("suppresses the Market status row only under the keys scope", () => {
    expect(scopeIncludesMarket(undefined)).toBe(true);
    expect(scopeIncludesMarket(MODEL_SOURCE_SCOPE.MARKET)).toBe(true);
    expect(scopeIncludesMarket(MODEL_SOURCE_SCOPE.KEYS)).toBe(false);
  });
});
