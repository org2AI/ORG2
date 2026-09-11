import { BaseDirectory, exists, writeFile } from "@tauri-apps/plugin-fs";

/** Exclusive creation preserves existing downloads, including concurrent saves. */
export async function downloadSharedSessionFile(
  file: { name: string; bytes: Uint8Array },
  isCurrent: () => boolean
): Promise<string | null> {
  if (
    !file.name ||
    file.name.includes("/") ||
    file.name.includes("\\") ||
    [...file.name].some((char) => char.charCodeAt(0) < 32) ||
    /^\.{1,2}$/.test(file.name)
  )
    throw new Error("Invalid download filename");
  const dot = file.name.lastIndexOf(".");
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const extension = dot > 0 ? file.name.slice(dot) : "";
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!isCurrent()) return null;
    const name = attempt ? `${stem} (${attempt})${extension}` : file.name;
    try {
      await writeFile(name, file.bytes, {
        baseDir: BaseDirectory.Download,
        createNew: true,
      });
      return name;
    } catch (error) {
      if (!(await exists(name, { baseDir: BaseDirectory.Download })))
        throw error;
    }
  }
  throw new Error("Too many downloads with the same filename");
}
