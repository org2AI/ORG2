import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SHARED_FILE_MAX_BYTES,
  encodeFileBytes,
  fileSha256,
  readSharedSessionFile,
  uploadSharedSessionFile,
} from "./sharedSessionFilesClient";

const endpoint = {
  supabaseUrl: "https://cloud.example",
  anonKey: "anon",
  webOrigin: "https://app.example",
  isOfficial: false,
};
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
describe("shared file wire boundary", () => {
  it("uploads binary bytes without local paths and verifies server digest", async () => {
    const bytes = new Uint8Array([0, 255, 128, 42]);
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id,
          name: "a.bin",
          size: bytes.length,
          sha256: await fileSha256(bytes),
        })
      )
    );
    vi.stubGlobal("fetch", fetch);
    await uploadSharedSessionFile(
      "jwt",
      endpoint,
      "org",
      "session",
      "a.bin",
      bytes
    );
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(
      "https://cloud.example/rest/v1/rpc/cloud_put_session_file"
    );
    expect(request.headers.authorization).toBe("Bearer jwt");
    expect(JSON.parse(request.body)).toEqual({
      p_org_id: "org",
      p_session_id: "session",
      p_name: "a.bin",
      p_content: encodeFileBytes(bytes),
    });
  });
  it("round trips binary data on the authorized read endpoint", async () => {
    const bytes = new Uint8Array([0, 255, 128, 42]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id,
            name: "a.bin",
            size: bytes.length,
            sha256: await fileSha256(bytes),
            content: encodeFileBytes(bytes),
          })
        )
      )
    );
    expect((await readSharedSessionFile("jwt", endpoint, id)).bytes).toEqual(
      bytes
    );
  });
  it("rejects corrupt content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id,
            name: "a",
            size: 1,
            sha256: "0".repeat(64),
            content: "YQ==",
          })
        )
      )
    );
    await expect(readSharedSessionFile("jwt", endpoint, id)).rejects.toThrow(
      "integrity"
    );
  });
  it("rejects access denial without a public/local fallback", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(readSharedSessionFile("jwt", endpoint, id)).rejects.toThrow(
      "403"
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects oversized upload before network IO", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      uploadSharedSessionFile(
        "jwt",
        endpoint,
        "org",
        "session",
        "a",
        new Uint8Array(SHARED_FILE_MAX_BYTES + 1)
      )
    ).rejects.toThrow("32 MiB");
    expect(fetch).not.toHaveBeenCalled();
  });
});
