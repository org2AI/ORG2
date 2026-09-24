import { afterEach, describe, expect, it, vi } from "vitest";

import { isRetryableCloudRequestError } from "./org2CloudFetchRetry";
import {
  SHARED_FILE_MAX_BYTES,
  SharedSessionFileRequestError,
  encodeFileBytes,
  fileSha256,
  findSharedSessionFile,
  findSharedSessionFileRevisions,
  findSharedSessionFileVersion,
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
  it("looks up exactly the original uploader and revision, without a path-only retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("null", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(
      await findSharedSessionFileVersion("jwt", endpoint, {
        orgId: "org",
        sessionId: "root",
        path: "/shared/file.md",
        version: { uploaderUserId: "guest", revision: "original:time" },
      })
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain(
      "/cloud_find_session_file_version"
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      p_org_id: "org",
      p_session_id: "root",
      p_source_path: "/shared/file.md",
      p_source_revision: "original:time",
      p_uploader_user_id: "guest",
    });
  });
  it.each([
    [{ code: "P0001", message: "ORG2_QUOTA_EXCEEDED" }, "ORG2_QUOTA_EXCEEDED"],
    [
      { code: "ORG2_FORBIDDEN", message: "private SQL details" },
      "ORG2_FORBIDDEN",
    ],
    [{ message: "private SQL details" }, null],
  ])(
    "preserves safe domain errors without exposing raw backend diagnostics",
    async (body, code) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(body), { status: 400 })
          )
      );
      const error = await uploadSharedSessionFile(
        "jwt",
        endpoint,
        "org",
        "session",
        "report.md",
        new Uint8Array([1])
      ).catch((error) => error);
      expect(error).toBeInstanceOf(SharedSessionFileRequestError);
      expect(error.code).toBe(code);
      if (code) expect(error.message).toContain(code);
      expect(error.message).not.toContain("private SQL details");
    }
  );
  it.each([503, 500, 403])(
    "preserves HTTP %s at lookup and upload boundaries",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("error", { status }))
      );
      for (const operation of [
        () =>
          findSharedSessionFileRevisions("jwt", endpoint, "org", "session", [
            { path: "/report.md", revision: "r1" },
          ]),
        () =>
          uploadSharedSessionFile(
            "jwt",
            endpoint,
            "org",
            "session",
            "report.md",
            new Uint8Array([1])
          ),
      ]) {
        const error = await operation().catch((error) => error);
        expect(error).toBeInstanceOf(SharedSessionFileRequestError);
        expect(error.status).toBe(status);
        expect(isRetryableCloudRequestError(error)).toBe(status >= 500);
      }
    }
  );
  it.each(["upload", "lookup"])(
    "aborts an in-flight %s request without transport retry",
    async (operation) => {
      const controller = new AbortController();
      let networkSignal: AbortSignal | undefined;
      const fetch = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            networkSignal = init.signal as AbortSignal;
            networkSignal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            );
          })
      );
      vi.stubGlobal("fetch", fetch);
      const pending =
        operation === "upload"
          ? uploadSharedSessionFile(
              "jwt",
              endpoint,
              "org",
              "session",
              "report.md",
              new Uint8Array([1]),
              undefined,
              controller.signal
            )
          : findSharedSessionFileRevisions(
              "jwt",
              endpoint,
              "org",
              "session",
              [],
              controller.signal
            );
      const assertion = expect(pending).rejects.toThrow("Aborted");
      controller.abort();
      await assertion;
      expect(networkSignal?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
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
  it("binds guest reads to the capability without trusting client org/session coordinates", async () => {
    const bytes = new Uint8Array([42]);
    const wire = {
      id,
      name: "a.bin",
      size: 1,
      sha256: await fileSha256(bytes),
      content: encodeFileBytes(bytes),
    };
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(wire)));
    vi.stubGlobal("fetch", fetch);
    await findSharedSessionFile(
      "jwt",
      endpoint,
      "untrusted-org",
      "untrusted-session",
      "/report",
      "r1",
      undefined,
      "ticket"
    );
    const signal = new AbortController().signal;
    expect(
      (await readSharedSessionFile("jwt", endpoint, id, signal, "ticket")).bytes
    ).toEqual(bytes);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${endpoint.supabaseUrl}/rest/v1/rpc/cloud_find_session_file_by_share`,
      `${endpoint.supabaseUrl}/rest/v1/rpc/cloud_get_session_file_by_share`,
    ]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      p_share_token: "ticket",
      p_source_path: "/report",
      p_source_revision: "r1",
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      p_share_token: "ticket",
      p_file_id: id,
    });
  });
  it("does not retry a rejected guest capability through the member read API", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      readSharedSessionFile("jwt", endpoint, id, undefined, "revoked")
    ).rejects.toThrow("403");
    expect(fetch).toHaveBeenCalledOnce();
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
