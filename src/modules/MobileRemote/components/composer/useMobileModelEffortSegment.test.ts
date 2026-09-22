// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { KEY_SOURCE } from "@src/api/tauri/session";
import type { MobileSessionModelConfig } from "@src/modules/MobileRemote/connection/types";

import {
  toMobileLastModelSelection,
  useMobileModelEffortSegment,
} from "./useMobileModelEffortSegment";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("useMobileModelEffortSegment session authority", () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each([
    ["gpt-5.6-sol", "common:selectors.modelProperties.default"],
    ["gpt-5.6-sol-high", "High"],
    ["gpt-5.6-sol-high-fast", "High · Fast"],
  ])("labels the stored %s without applying a picker seed", (model, label) => {
    const onApply = vi.fn();
    let state: ReturnType<typeof useMobileModelEffortSegment> | undefined;
    function Probe() {
      const nextState = useMobileModelEffortSegment(
        { sessionId: "s", model, accountId: "a", modelEditable: true },
        [
          "gpt-5.6-sol",
          "gpt-5.6-sol-low",
          "gpt-5.6-sol-medium",
          "gpt-5.6-sol-high",
          "gpt-5.6-sol-high-fast",
        ].map((id) => ({ id, accountId: "a", accountLabel: "A" })),
        onApply
      );
      useEffect(() => {
        state = nextState;
      }, [nextState]);
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(React.createElement(Probe)));
      expect(state?.modelId).toBe(model);
      expect(state?.effortLabel).toBe(label);
      expect(onApply).not.toHaveBeenCalled();
      act(() => state?.handleApply("gpt-5.6-sol-medium"));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith("gpt-5.6-sol-medium");
    } finally {
      act(() => root.unmount());
    }
  });
});

describe("toMobileLastModelSelection", () => {
  it("maps own-key sessions to LastModelSelection", () => {
    const config: MobileSessionModelConfig = {
      sessionId: "s1",
      model: "claude-sonnet-4-5",
      accountId: "acct-1",
      keySource: KEY_SOURCE.OWN,
      modelEditable: true,
    };
    expect(toMobileLastModelSelection(config)).toEqual({
      keySource: KEY_SOURCE.OWN,
      model: "claude-sonnet-4-5",
      selectedAccountId: "acct-1",
      cliAgentType: undefined,
    });
  });

  it("maps hosted sessions to listing model fields", () => {
    const config: MobileSessionModelConfig = {
      sessionId: "s1",
      model: "gpt-5.6-sol-max",
      keySource: KEY_SOURCE.HOSTED,
      modelEditable: true,
    };
    expect(toMobileLastModelSelection(config)).toEqual({
      keySource: KEY_SOURCE.HOSTED,
      listingModel: "gpt-5.6-sol-max",
      cliAgentType: undefined,
    });
  });
});
