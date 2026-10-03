import { describe, expect, it } from "vitest";

import {
  AGENT_ORG_FINALIZING_INPUT_NOT_ACCEPTED,
  isAgentOrgFinalizingInputError,
} from "../orgTasks/errors";

describe("isAgentOrgFinalizingInputError", () => {
  it("recognizes the stable backend rejection with or without a run id", () => {
    expect(
      isAgentOrgFinalizingInputError(
        new Error(`${AGENT_ORG_FINALIZING_INPUT_NOT_ACCEPTED}:run-a`)
      )
    ).toBe(true);
    expect(
      isAgentOrgFinalizingInputError(AGENT_ORG_FINALIZING_INPUT_NOT_ACCEPTED)
    ).toBe(true);
  });

  it("does not turn unknown delivery errors into explicit rejections", () => {
    expect(isAgentOrgFinalizingInputError("transport outcome unknown")).toBe(
      false
    );
  });
});
