import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { RpcError, defineProcedure, typedInvoke } from "../invoke";
import { SessionAggregateRecordSchema } from "../schemas/sessionAggregate";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

afterEach(() => {
  vi.unstubAllEnvs();
  invokeMock.mockReset();
});

describe.each(["development", "production"])("RPC decoding in %s", (mode) => {
  it.each([
    ["cli", "cli_agent"],
    ["agent", "rust_agent"],
    ["os", "rust_agent"],
    ["human", "human_session"],
  ])(
    "decodes category %s and omitted defaults at the IPC boundary",
    async (wire, domain) => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue({ category: wire });
      const procedure = defineProcedure("session-contract")
        .output(
          SessionAggregateRecordSchema.pick({ category: true, pinned: true })
        )
        .build();
      expect(await typedInvoke(procedure)).toEqual({
        category: domain,
        pinned: false,
      });
    }
  );

  it("rejects malformed success responses instead of returning an invalid typed value", async () => {
    vi.stubEnv("NODE_ENV", mode);
    invokeMock.mockResolvedValue({ count: "bad" });
    const procedure = defineProcedure("counts")
      .output(z.object({ count: z.number() }))
      .build();
    await expect(typedInvoke(procedure)).rejects.toBeInstanceOf(RpcError);
    await expect(typedInvoke(procedure)).rejects.toThrow(
      "[RPC:counts] Invalid output"
    );
  });

  it("applies explicit wire transforms before schema decoding", async () => {
    vi.stubEnv("NODE_ENV", mode);
    invokeMock.mockResolvedValue({ wire_count: "3" });
    const procedure = defineProcedure("counts")
      .transform((raw) => ({
        count: (raw as { wire_count: string }).wire_count,
      }))
      .output(
        z.object({
          count: z.string().transform(Number),
          labels: z.array(z.string()).default([]),
        })
      )
      .build();
    expect(await typedInvoke(procedure)).toEqual({ count: 3, labels: [] });
  });
});
