import { expect, it } from "vitest";

import { marketActivationErrorCode } from "./activationError";

it("retains only explicitly allowed activation failures", () => {
  expect(
    marketActivationErrorCode(new Error("model_temporarily_unavailable"))
  ).toBe("model_temporarily_unavailable");
  for (const error of [
    new Error("https://example.test?token=secret"),
    "market_secret_token",
    { cause: "model_temporarily_unavailable" },
    null,
  ]) {
    expect(marketActivationErrorCode(error)).toBe("market_activation_failed");
  }
});
