import { expect, it } from "vitest";

import { marketAppSchemeSchema } from "./appScheme";
import { isMarketAppUrl } from "./urlPolicy";

it("accepts exactly the canonical desktop build scheme families", () => {
  const schemes = ["orgii", "orgii-dev", "orgii-market-local-12abcdef"];
  for (let instance = 2; instance <= 99; instance++)
    schemes.push(`orgii-instance${instance}`);
  for (const scheme of schemes)
    expect(marketAppSchemeSchema.safeParse(scheme).success, scheme).toBe(true);
});

it("rejects invalid instance numbers, alternate encodings and arbitrary suffixes", () => {
  for (const scheme of [
    "orgii-instance0",
    "orgii-instance1",
    "orgii-instance100",
    "orgii-instance02",
    "orgii-instance093",
    "orgii-instance+2",
    "orgii-instance2x",
    "orgii-instance2-dev",
    "orgii-dev-other",
    "orgii-market-local-12ABCDEF",
    "orgii-market-local-12abcde",
    "orgii-market-local-12abcdef0",
    "orgii\n",
    "orgii-instance93\n",
    "orgii-instance93\r\n",
    "orgii-dev ",
    "https",
  ])
    expect(marketAppSchemeSchema.safeParse(scheme).success, scheme).toBe(false);
});

it("keeps navigation bound to this build's exact scheme", () => {
  const compiled = process.env.ORGII_DEEP_LINK_SCHEME ?? "orgii";
  for (const scheme of [
    "orgii",
    "orgii-dev",
    "orgii-instance2",
    "orgii-instance93",
    "orgii-instance99",
    compiled,
  ])
    expect(isMarketAppUrl(new URL(`${scheme}://market/connect`))).toBe(
      scheme === compiled
    );
});
