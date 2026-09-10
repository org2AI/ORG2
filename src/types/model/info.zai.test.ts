import { describe, expect, it } from "vitest";

import { getModelInfo } from "./info";

describe("Z.AI model info", () => {
  it("uses the GLM-5.3 window before the conservative GLM-5 fallback", () => {
    for (const model of ["glm-5.3", "glm-5.3-high", "zai/glm-5.3-max"]) {
      expect(getModelInfo(model)).toMatchObject({
        providerKey: "zai",
        contextWindow: 1000,
        reasoning: true,
      });
    }

    expect(getModelInfo("glm-5.1")?.contextWindow).toBe(200);
    expect(getModelInfo("glm-5")?.contextWindow).toBe(200);
  });
});
