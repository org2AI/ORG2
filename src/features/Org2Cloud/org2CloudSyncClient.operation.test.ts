import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

import { getCloudEndpoint } from "./config";
import { getCloudCapabilities } from "./org2CloudCapabilities";
import {
  resetOrgEndpointDirectory,
  setOrgEndpointDirectory,
} from "./org2CloudOrgEndpointRouter";
import {
  __STORAGE_SEGMENTS_INTERNALS,
  rewriteSessionEvents,
  upsertSessionMetadata,
} from "./org2CloudSyncClient";
import type { CloudSyncRequestOptions } from "./org2CloudSyncRequest.types";

vi.mock("./org2CloudCapabilities", () => ({ getCloudCapabilities: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
const capabilitiesMock = vi.mocked(getCloudCapabilities);

function context() {
  const controller = new AbortController();
  let current = true;
  const options: CloudSyncRequestOptions = {
    endpoint: {
      ...getCloudEndpoint(),
      supabaseUrl: "https://original.example",
      anonKey: "original-anon",
    },
    signal: controller.signal,
    assertCurrent() {
      if (!current) {
        controller.abort();
        throw new DOMException("Endpoint changed", "AbortError");
      }
    },
  };
  return {
    options,
    invalidate: () => {
      current = false;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  __STORAGE_SEGMENTS_INTERNALS.resetStorageSupport();
});
afterEach(() => {
  resetOrgEndpointDirectory();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const input = {
  orgId: "org",
  sessionId: "session",
  newEpoch: 1,
  frozenSegments: [
    {
      seq: 1,
      events: [{ id: "one", displayStatus: "completed" } as SessionEvent],
    },
  ],
  tail: null,
  totalCount: 1,
};

describe("session writer network boundary", () => {
  it("sends the fixed endpoint, token and metadata without serializing local operation state", async () => {
    const { options } = context();
    setOrgEndpointDirectory([
      [
        "org",
        { ...options.endpoint, supabaseUrl: "https://replacement.example" },
      ],
    ]);
    fetchMock.mockResolvedValue(new Response("null"));
    const metadata = {
      title: "original content",
    } as RemoteTeammateSessionMetadata;
    await upsertSessionMetadata(
      "original-token",
      "org",
      "session",
      metadata,
      options
    );
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://original.example/rest/v1/rpc/cloud_upsert_session_metadata"
    );
    expect(request?.headers).toMatchObject({
      authorization: "Bearer original-token",
      apikey: "original-anon",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      p_org_id: "org",
      p_session_id: "session",
      metadata,
    });
    expect(request?.signal).toBe(options.signal);
  });

  it("rechecks cancellation after capability preparation before writing replay bytes", async () => {
    const { options, invalidate } = context();
    capabilitiesMock.mockImplementationOnce(async () => {
      invalidate();
      return { storageSegments: false } as Awaited<
        ReturnType<typeof getCloudCapabilities>
      >;
    });
    await expect(
      rewriteSessionEvents("original-token", input, options)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(capabilitiesMock).toHaveBeenCalledWith(
      "original-token",
      options.endpoint
    );
  });

  it("does not POST an object when identity changes during the HEAD existence check", async () => {
    const { options, invalidate } = context();
    capabilitiesMock.mockResolvedValue({ storageSegments: true } as Awaited<
      ReturnType<typeof getCloudCapabilities>
    >);
    fetchMock.mockImplementationOnce(async (_url, request) => {
      expect(request?.method).toBe("HEAD");
      invalidate();
      return new Response(null, { status: 404 });
    });
    await expect(
      rewriteSessionEvents("original-token", input, options)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
