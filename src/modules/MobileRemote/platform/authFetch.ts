/** Small auth-only responses: one deadline covers headers and body. No timer
 * survives success/failure, and caller cancellation remains authoritative. */
export function createBoundedAuthFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const upstream =
      init?.signal ?? (input instanceof Request ? input.signal : null);
    const abort = () => controller.abort();
    upstream?.throwIfAborted();
    upstream?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 10_000);
    try {
      const response = await fetcher(input, {
        ...init,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.body) return response;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (
          let result = await reader.read();
          !result.done;
          result = await reader.read()
        ) {
          controller.signal.throwIfAborted();
          const { value } = result;
          size += value.byteLength;
          if (size > 64 * 1024)
            throw new Error("Authentication response exceeded its size limit");
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      controller.signal.throwIfAborted();
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener("abort", abort);
    }
  };
}
