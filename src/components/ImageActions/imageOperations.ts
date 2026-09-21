import { invoke, isTauri } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { readFile, stat, writeFile } from "@tauri-apps/plugin-fs";

import {
  imageRefToRustPath,
  parseTranscriptImageRef,
} from "@src/util/file/imageRefs";
import { getImageMimeType } from "@src/util/file/previewTypes";

export interface ImageActionSource {
  src: string;
  fileName?: string;
  /** Proven local reference, retained separately from the display Blob URL. */
  localPath?: string;
}

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

async function readRemoteImage(response: Response): Promise<Blob> {
  if (Number(response.headers?.get("content-length")) > MAX_IMAGE_BYTES)
    throw new Error("Image is too large");
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      const { value } = chunk;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Image is too large");
      chunks.push(value);
      chunk = await reader.read();
    }
    return new Blob(chunks, {
      type:
        response.headers.get("content-type")?.split(";")[0] ||
        "application/octet-stream",
    });
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

export function localImagePath(ref?: string): string | undefined {
  if (!ref || parseTranscriptImageRef(ref)) return undefined;
  const path = imageRefToRustPath(ref);
  return /^(?:\/|~\/|[a-z]:[\\/]|\\\\)/i.test(path) ? path : undefined;
}

async function absolutePath(path: string) {
  return path.startsWith("~/") ? join(await homeDir(), path.slice(2)) : path;
}

export async function readActionImage(
  source: ImageActionSource,
  signal: AbortSignal
): Promise<Blob> {
  signal.throwIfAborted();
  let blob: Blob;
  if (source.localPath) {
    const path = await absolutePath(source.localPath);
    if ((await stat(path)).size > MAX_IMAGE_BYTES)
      throw new Error("Image is too large");
    signal.throwIfAborted();
    const bytes = await readFile(path);
    blob = new Blob([bytes], {
      type: getImageMimeType(source.localPath) ?? "image/png",
    });
  } else {
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => request.abort(), 30_000);
    try {
      const response = await fetch(source.src, { signal: request.signal });
      if (!response.ok)
        throw new Error(`Image read failed: ${response.status}`);
      blob = await readRemoteImage(response);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  signal.throwIfAborted();
  if (!blob.size || blob.size > MAX_IMAGE_BYTES)
    throw new Error("Invalid image size");
  return blob;
}

export function imageFileName(source: ImageActionSource, mime: string): string {
  const name = source.fileName ?? source.localPath?.split(/[\\/]/).pop();
  const extension =
    mime === "image/jpeg"
      ? "jpg"
      : mime.split("/")[1]?.replace("+xml", "") || "png";
  return name?.replace(/[\\/:*?"<>|]/g, "_") || `image.${extension}`;
}

export async function revealImage(source: ImageActionSource) {
  if (!source.localPath) throw new Error("Image has no local file");
  await invoke("show_in_folder", {
    path: await absolutePath(source.localPath),
  });
}

export async function downloadImage(
  source: ImageActionSource,
  signal: AbortSignal
): Promise<void> {
  if (!isTauri()) {
    const link = document.createElement("a");
    link.href = source.src;
    link.download = source.fileName || "image.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }
  const blob = await readActionImage(source, signal);
  const path = await save({ defaultPath: imageFileName(source, blob.type) });
  signal.throwIfAborted();
  if (path) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    signal.throwIfAborted();
    await writeFile(path, bytes);
  }
}

function imageCanvas(image: HTMLImageElement): HTMLCanvasElement {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight)
    throw new Error("Image is not ready");
  if (image.naturalWidth * image.naturalHeight > 16_777_216)
    throw new Error("Image is too large for clipboard");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.width = canvas.height = 0;
    throw new Error("Image conversion unavailable");
  }
  try {
    context.drawImage(image, 0, 0);
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
  }
  return canvas;
}

/** Keep clipboard.write in the browser click stack (including WebKit). */
export async function copyDisplayedImage(
  image: HTMLImageElement | null
): Promise<void> {
  if (!image) throw new Error("Image is not ready");
  const canvas = imageCanvas(image);
  const png = new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        canvas.width = canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new Error("Image conversion failed"));
      }, "image/png");
    } catch (error) {
      canvas.width = canvas.height = 0;
      reject(error);
    }
  });
  void png.catch(() => {});
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** Native menus deliver IPC callbacks, which carry no browser user activation. */
export async function copyNativeImage(
  source: ImageActionSource,
  signal: AbortSignal
) {
  const blob = await readActionImage(source, signal);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    canvas = imageCanvas(image);
    const rgba = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height);
    await invoke("clipboard_write_image", new Uint8Array(rgba.data.buffer), {
      headers: {
        "x-image-width": String(canvas.width),
        "x-image-height": String(canvas.height),
      },
    });
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
