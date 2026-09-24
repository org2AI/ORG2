import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRetryableCloudRequestError } from "./org2CloudFetchRetry";
import {
  SHARED_FILE_MAX_BYTES,
  SharedSessionFileRequestError,
  encodeFileBytes,
  fileSha256,
  findSharedSessionFile,
  findSharedSessionFileRevisions,
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("shared file wire boundary", () => {
  describe.each(["native", "fallback"] as const)(
    "%s Base64 encoder",
    (mode) => {
      it.each([0, 1, 2, 3, 24575, 24576, 24577, 1048577])(
        "preserves padding, binary values, and view bounds for %s bytes",
        (size) => {
          const backing = new Uint8Array(size + 2);
          backing.fill(255);
          const bytes = backing.subarray(1, size + 1);
          for (let i = 0; i < size; i++) bytes[i] = i % 256;
          const native = vi.fn(function (this: Uint8Array) {
            return Buffer.from(this).toString("base64");
          });
          Object.defineProperty(bytes, "toBase64", {
            value: mode === "native" ? native : undefined,
          });
          expect(encodeFileBytes(bytes)).toBe(
            Buffer.from(bytes).toString("base64")
          );
          if (mode === "native") {
            expect(native).toHaveBeenCalledOnce();
            expect(native.mock.contexts[0]).toBe(bytes);
          }
        }
      );
    }
  );
  it("downloads a multi-chunk binary payload without changing its bytes", async () => {
    const bytes = new Uint8Array(1024 * 1024 + 1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id,
            name: "binary.dat",
            size: bytes.length,
            sha256: await fileSha256(bytes),
            content: Buffer.from(bytes).toString("base64"),
          })
        )
      )
    );
    expect((await readSharedSessionFile("jwt", endpoint, id)).bytes).toEqual(
      bytes
    );
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
      const assertion = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      controller.abort();
      await assertion;
      expect(networkSignal?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
  it.each(["fetch", "body"])(
    "enforces the deadline when %s ignores abort",
    async (phase) => {
      vi.useFakeTimers();
      let networkSignal: AbortSignal | undefined;
      const never = new Promise<never>(() => {});
      const fetch = vi.fn((_url: string, init: RequestInit) => {
        networkSignal = init.signal as AbortSignal;
        return phase === "fetch"
          ? never
          : Promise.resolve({ ok: true, json: () => never });
      });
      vi.stubGlobal("fetch", fetch);
      const pending = readSharedSessionFile("jwt", endpoint, id);
      const assertion = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
      expect(networkSignal?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it("settles caller cancellation even when fetch ignores abort", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const pending = readSharedSessionFile(
      "jwt",
      endpoint,
      id,
      controller.signal
    );
    const assertion = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await assertion;
  });
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
