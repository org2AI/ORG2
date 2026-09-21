import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  peekShareableScopeKeys,
  primeShareableScopeKey,
} from "../TeamCollaboration/repoScopeResolver";
import { getSessionScopeKeys } from "./org2CloudSyncEngine.repoScopeSync";

vi.mock("../TeamCollaboration/repoScopeResolver", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../TeamCollaboration/repoScopeResolver")
    >();
  return {
    ...actual,
    peekShareableScopeKeys: vi.fn(),
    primeShareableScopeKey: vi.fn(),
  };
});

const peekMock = vi.mocked(peekShareableScopeKeys);
const primeMock = vi.mocked(primeShareableScopeKey);

const REPO_PATH = "/Users/me/org2";

function nativeSession(repoPath: string | undefined) {
  return {
    session_id: "native-1",
    repoPath,
    repoRemoteUrls: undefined,
    parentSessionId: undefined,
  };
}

beforeEach(() => {
  peekMock.mockReset();
  primeMock.mockReset();
});

describe("getSessionScopeKeys", () => {
  describe("imported history (persisted remotes, never probes the checkout)", () => {
    it("returns the normalized persisted remote keys", () => {
      expect(
        getSessionScopeKeys({
          session_id: "claudecodeapp-1",
          repoPath: REPO_PATH,
          repoRemoteUrls: [
            "git@github.com:org2ai/org2.git",
            "https://github.com/org2ai/org2.git",
            "https://github.com/example/other.git",
          ],
          parentSessionId: undefined,
        })
      ).toEqual(["github.com/org2ai/org2", "github.com/example/other"]);
      expect(peekMock).not.toHaveBeenCalled();
      expect(primeMock).not.toHaveBeenCalled();
    });

    it("returns null for an imported session with no cached remote", () => {
      expect(
        getSessionScopeKeys({
          session_id: "claudecodeapp-4",
          repoPath: REPO_PATH,
          repoRemoteUrls: undefined,
          parentSessionId: undefined,
        })
      ).toBeNull();
      expect(peekMock).not.toHaveBeenCalled();
      expect(primeMock).not.toHaveBeenCalled();
    });

    it("returns null for a spawned child even when its remotes are shareable", () => {
      expect(
        getSessionScopeKeys({
          session_id: "claudecodeapp-agent-a5",
          repoPath: REPO_PATH,
          repoRemoteUrls: ["git@github.com:org2ai/org2.git"],
          parentSessionId: "claudecodeapp-1",
        })
      ).toBeNull();
      expect(peekMock).not.toHaveBeenCalled();
      expect(primeMock).not.toHaveBeenCalled();
    });
  });

  describe("native session without a checkout", () => {
    it.each([undefined, ""])(
      "returns null for repoPath %j without touching the resolver",
      (repoPath) => {
        expect(getSessionScopeKeys(nativeSession(repoPath))).toBeNull();
        expect(peekMock).not.toHaveBeenCalled();
        expect(primeMock).not.toHaveBeenCalled();
      }
    );
  });

  describe("native session with a checkout (resolver cache)", () => {
    it("returns cached keys without re-priming", () => {
      peekMock.mockReturnValue(["github.com/org2ai/org2"]);
      expect(getSessionScopeKeys(nativeSession(REPO_PATH))).toEqual([
        "github.com/org2ai/org2",
      ]);
      expect(peekMock).toHaveBeenCalledWith(REPO_PATH);
      expect(primeMock).not.toHaveBeenCalled();
    });

    it("returns the cached not-shareable null without re-priming", () => {
      peekMock.mockReturnValue(null);
      expect(getSessionScopeKeys(nativeSession(REPO_PATH))).toBeNull();
      expect(peekMock).toHaveBeenCalledWith(REPO_PATH);
      expect(primeMock).not.toHaveBeenCalled();
    });

    it("returns undefined and primes exactly once while resolution is in flight", () => {
      peekMock.mockReturnValue(undefined);
      expect(getSessionScopeKeys(nativeSession(REPO_PATH))).toBeUndefined();
      expect(peekMock).toHaveBeenCalledWith(REPO_PATH);
      expect(primeMock).toHaveBeenCalledTimes(1);
      expect(primeMock).toHaveBeenCalledWith(REPO_PATH);
    });
  });
});
