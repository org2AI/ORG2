import { beforeEach, describe, expect, it, vi } from "vitest";

import { nativeCliTurnLoader } from "./nativeCliTurnLoader";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  merge: vi.fn(),
  generation: 0,
}));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { cli: { history: mocks.history } },
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { mergeRoundWindowEvents: mocks.merge },
}));
vi.mock("./loadedTurnRegistry", () => ({
  captureLoadedTurnRegistryGeneration: () => mocks.generation,
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset:${path}`,
}));

const request = { sessionId: "cliagent-test", turnId: "old-turn" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 0;
});
describe("native CLI turn loading", () => {
  it("loads the requested body and converts native image references", async () => {
    mocks.history.mockResolvedValue([
      {
        id: "body",
        result: { images: ["/fixture.png", "data:image/png;base64,abc"] },
      },
    ]);
    expect(await nativeCliTurnLoader.loadTurnBodyIntoStore(request)).toBe(true);
    expect(mocks.history).toHaveBeenCalledWith({
      sessionId: request.sessionId,
      read: { kind: "turn", turnId: request.turnId },
    });
    expect(mocks.merge).toHaveBeenCalledWith(
      [
        {
          id: "body",
          result: {
            images: ["asset:/fixture.png", "data:image/png;base64,abc"],
          },
        },
      ],
      request.sessionId
    );
  });
  it("does not merge a body read before the transcript was replaced", async () => {
    mocks.history.mockImplementation(async () => {
      mocks.generation++;
      return [{ id: "stale" }];
    });
    expect(await nativeCliTurnLoader.loadTurnBodyIntoStore(request)).toBe(
      false
    );
    expect(mocks.merge).not.toHaveBeenCalled();
  });
  it("does not mark an empty body as loaded", async () => {
    mocks.history.mockResolvedValue([]);
    expect(await nativeCliTurnLoader.loadTurnBodyIntoStore(request)).toBe(
      false
    );
    expect(mocks.merge).not.toHaveBeenCalled();
  });
});
