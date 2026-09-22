import { describe, expect, it } from "vitest";

import { RUN_GROUP_MAX_STORED } from "@src/features/SessionCreator/multiRunner/runGroupContract";

import { runGroupByIdAtom } from "../runGroupsAtom";

describe("runGroupByIdAtom", () => {
  it("keeps recently used selectors while bounding the long-lived cache", () => {
    const oldest = runGroupByIdAtom("oldest");
    const retained = runGroupByIdAtom("retained");
    for (let index = 0; index < RUN_GROUP_MAX_STORED - 2; index++) {
      runGroupByIdAtom(`group-${index}`);
    }
    expect(runGroupByIdAtom("retained")).toBe(retained);
    runGroupByIdAtom("newest");
    expect(runGroupByIdAtom("retained")).toBe(retained);
    expect(runGroupByIdAtom("oldest")).not.toBe(oldest);
  });
});
