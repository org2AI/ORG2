import { vi } from "vitest";

import { calculateAutoLayout } from "../config";

vi.mock("@src/store/ui/simulatorAtom", () => ({ SimulatorGridLayout: {} }));

describe("calculateAutoLayout", () => {
  it("maps task counts to grid layouts", () => {
    expect(calculateAutoLayout(0)).toBe("1x1");
    expect(calculateAutoLayout(1)).toBe("1x1");
    expect(calculateAutoLayout(2)).toBe("1x2");
    expect(calculateAutoLayout(3)).toBe("2x2");
    expect(calculateAutoLayout(4)).toBe("2x2");
    expect(calculateAutoLayout(5)).toBe("2x3");
    expect(calculateAutoLayout(6)).toBe("2x3");
    expect(calculateAutoLayout(7)).toBe("4x2");
    expect(calculateAutoLayout(8)).toBe("4x2");
    expect(calculateAutoLayout(9)).toBe("3x3");
    expect(calculateAutoLayout(10)).toBe("3x4");
    expect(calculateAutoLayout(12)).toBe("3x4");
  });
});
