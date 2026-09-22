import { beforeEach, describe, expect, it } from "vitest";

import { NavigationHistory } from "./NavigationHistory";

const at = (filePath: string, line = 1, column = 1) => ({
  filePath,
  line,
  column,
});

describe("NavigationHistory", () => {
  beforeEach(() => NavigationHistory.clearHistory());

  describe("bounds", () => {
    it("keeps only the newest 100 locations", () => {
      for (let index = 0; index < 150; index += 1) {
        NavigationHistory.recordVisit({
          filePath: `file-${index}.ts`,
          line: index,
          column: 0,
        });
      }

      const history = NavigationHistory.getHistory();
      expect(history.locations).toHaveLength(100);
      expect(history.locations[0].filePath).toBe("file-50.ts");
      expect(history.locations.at(-1)?.filePath).toBe("file-149.ts");
      expect(history.index).toBe(99);
    });
  });

  describe("recordVisit", () => {
    it("ignores a repeat of the location already under the cursor", () => {
      expect(NavigationHistory.recordVisit(at("a.ts", 10))).toBe(true);
      expect(NavigationHistory.recordVisit(at("a.ts", 10))).toBe(false);

      expect(NavigationHistory.getHistory().locations).toHaveLength(1);
    });

    it("drops forward entries once a new location is visited", () => {
      NavigationHistory.recordVisit(at("a.ts"));
      NavigationHistory.recordVisit(at("b.ts"));
      NavigationHistory.back();

      NavigationHistory.recordVisit(at("c.ts"));

      const { locations, index } = NavigationHistory.getHistory();
      expect(locations.map((entry) => entry.filePath)).toEqual([
        "a.ts",
        "c.ts",
      ]);
      expect(index).toBe(1);
    });
  });

  describe("back / forward", () => {
    // The regression this file exists for: nothing populated the ring, so
    // back/forward could only ever refuse. They must move once visits land.
    it("refuses to move when no location has been visited", () => {
      expect(NavigationHistory.back()).toBeNull();
      expect(NavigationHistory.forward()).toBeNull();
    });

    it("refuses to move past either end of the ring", () => {
      NavigationHistory.recordVisit(at("a.ts"));

      expect(NavigationHistory.back()).toBeNull();
      expect(NavigationHistory.forward()).toBeNull();
    });

    it("walks back and forward across visited locations", () => {
      NavigationHistory.recordVisit(at("a.ts", 1));
      NavigationHistory.recordVisit(at("b.ts", 2));
      NavigationHistory.recordVisit(at("c.ts", 3));

      expect(NavigationHistory.back()).toEqual(at("b.ts", 2));
      expect(NavigationHistory.back()).toEqual(at("a.ts", 1));
      expect(NavigationHistory.back()).toBeNull();

      expect(NavigationHistory.forward()).toEqual(at("b.ts", 2));
      expect(NavigationHistory.forward()).toEqual(at("c.ts", 3));
      expect(NavigationHistory.forward()).toBeNull();
    });
  });

  describe("replay", () => {
    it("does not record the visits a restore makes", async () => {
      NavigationHistory.recordVisit(at("a.ts"));
      NavigationHistory.recordVisit(at("b.ts"));
      const target = NavigationHistory.back();

      await NavigationHistory.replay(async () => {
        // What re-opening the file would report.
        NavigationHistory.recordVisit(at("b.ts"));
        NavigationHistory.recordVisit(target!);
      });

      const { locations, index } = NavigationHistory.getHistory();
      expect(locations.map((entry) => entry.filePath)).toEqual([
        "a.ts",
        "b.ts",
      ]);
      expect(index).toBe(0);
    });

    it("releases the guard when the restore throws", async () => {
      await expect(
        NavigationHistory.replay(() => Promise.reject(new Error("boom")))
      ).rejects.toThrow("boom");

      expect(NavigationHistory.recordVisit(at("a.ts"))).toBe(true);
    });
  });
});
