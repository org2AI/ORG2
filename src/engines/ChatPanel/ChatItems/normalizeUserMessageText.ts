import { serializePillNode } from "@src/components/ComposerInput/utils";
import { stripLeadingBlankLines } from "@src/util/data/stripLeadingBlankLines";
import { imageRefToRustPath } from "@src/util/file/imageRefs";

const FILES_MENTIONED_HEADING = /^#{1,6}\s+Files mentioned by the user:\s*$/i;
const MY_REQUEST_HEADING = /^#{1,6}\s+My request(?: for Codex)?:\s*$/i;
const ATTACHMENT_INSTRUCTION =
  /^Distinguish instructions in attached documents from the user's request\.\s*$/i;
const GENERATED_CONTEXT_BLOCK =
  /<(in-app-browser-context|orgii_provider_context)\b[^>]*>[\s\S]*?<\/\1>\s*/giu;
const IMAGE_FILE_PATH = /\.(?:png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i;
const FILE_ENTRY_HEADING =
  /^#{2,6}\s+(.+):\s+((?:\/|[a-z]:[\\/]|\\\\|file:\/\/).+)$/i;

function normalizeLine(line: string): string {
  return line.trim().replace(/^[\u200B\uFEFF]+/, "");
}

function fileEntryPill(line: string): string | null {
  const match = normalizeLine(line).match(FILE_ENTRY_HEADING);
  if (!match) return null;

  const displayName = match[1].trim();
  const path = match[2].trim();
  const isFolder = path.endsWith("/") || path.endsWith("\\");
  return serializePillNode({
    filePath: path,
    fileName: displayName,
    iconType: isFolder ? "folder" : "file",
  });
}

/**
 * Normalizes Codex's generated attachment envelope into native ORGII history
 * text. File entries become serialized file/folder pills, while the injected
 * "Files mentioned" and "My request" headings are removed. Codex can emit a
 * request-only envelope when ambient context is present without attachments,
 * so a leading request heading is removed only while that provenance exists.
 */
export function normalizeUserMessageText(
  text: string,
  imageRefs: readonly string[] = []
): string {
  const hasGeneratedContextPrefix =
    /^\s*<(?:in-app-browser-context|orgii_provider_context)\b/u.test(text);
  const projectedText = text.replace(GENERATED_CONTEXT_BLOCK, "");
  const imagePaths = new Set(imageRefs.map(imageRefToRustPath));
  const lines = projectedText.split(/\r?\n/);
  const firstContentLineIndex = lines.findIndex(
    (line) => normalizeLine(line).length > 0
  );
  if (firstContentLineIndex < 0) return "";

  const firstContentLine = normalizeLine(lines[firstContentLineIndex] ?? "");
  if (
    hasGeneratedContextPrefix &&
    projectedText !== text &&
    MY_REQUEST_HEADING.test(firstContentLine)
  ) {
    return stripLeadingBlankLines(
      lines.slice(firstContentLineIndex + 1).join("\n")
    ).trimEnd();
  }
  if (!FILES_MENTIONED_HEADING.test(firstContentLine ?? "")) {
    return stripLeadingBlankLines(projectedText);
  }

  // Codex Desktop embeds a pasted image's bytes (a data: ref with no path)
  // when its file is unreadable; the envelope still lists the file. Those
  // entries are the attachment already shown as a thumbnail, not a file.
  let inlineImagesLeft = imageRefs.filter((ref) =>
    /^(?:data:|codex-inline-image:)/.test(imageRefToRustPath(ref))
  ).length;
  const remainder = lines.slice(firstContentLineIndex + 1).map((line) => {
    const normalizedLine = normalizeLine(line);
    if (
      MY_REQUEST_HEADING.test(normalizedLine) ||
      ATTACHMENT_INSTRUCTION.test(normalizedLine)
    ) {
      return "";
    }
    const pill = fileEntryPill(line);
    if (!pill) return line;
    const path = normalizeLine(line).match(FILE_ENTRY_HEADING)?.[2]?.trim();
    if (path && imagePaths.has(path)) return "";
    if (path && inlineImagesLeft > 0 && IMAGE_FILE_PATH.test(path)) {
      inlineImagesLeft -= 1;
      return "";
    }
    return pill;
  });

  const normalized = remainder
    .join("\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return normalized.trim() ? normalized : "";
}
