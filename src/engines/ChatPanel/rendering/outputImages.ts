/** Read explicit image content only; never guess paths from tool prose. */
export function outputImages(result: Record<string, unknown>): string[] {
  const images: string[] = [];
  const add = (value: unknown) => {
    if (
      typeof value === "string" &&
      /^(data:image\/(png|jpeg|gif|webp);base64,|https?:\/\/|orgii-transcript-image:|\/|[a-z]:[\\/])/i.test(
        value
      ) &&
      !images.includes(value)
    )
      images.push(value);
  };
  if (Array.isArray(result.images)) result.images.forEach(add);
  const visit = (content: unknown) => {
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (
        ["image", "input_image", "output_image", "image_url"].includes(
          part.type
        )
      ) {
        add(
          typeof part.image_url === "object"
            ? part.image_url?.url
            : part.image_url
        );
        const source = part.source ?? part;
        if (source.type === "url") add(source.url);
        const mime = source.media_type ?? source.mimeType;
        if (
          typeof source.data === "string" &&
          /^image\/(png|jpeg|gif|webp)$/.test(mime)
        )
          add(`data:${mime};base64,${source.data}`);
      }
    }
  };
  visit(result.content);
  visit(result.output);
  return images;
}

/** Grouping must not allocate copies of embedded image bytes. */
export function hasOutputImages(
  result: Record<string, unknown> | undefined
): boolean {
  if (!result) return false;
  if (Array.isArray(result.images) && result.images.length > 0) return true;
  return [result.content, result.output].some(
    (content) =>
      Array.isArray(content) &&
      content.some(
        (part) =>
          part &&
          typeof part === "object" &&
          ["image", "input_image", "output_image", "image_url"].includes(
            part.type
          )
      )
  );
}

/** The media row owns image display; tool JSON must not stringify image bytes. */
export function textOnlyOutputResult(
  result: Record<string, unknown>
): Record<string, unknown> {
  if (!hasOutputImages(result)) return result;
  const { images: _images, ...textResult } = result;
  for (const field of ["content", "output"]) {
    const parts = textResult[field];
    if (Array.isArray(parts)) {
      textResult[field] = parts.filter(
        (part) =>
          !part ||
          typeof part !== "object" ||
          !["image", "input_image", "output_image", "image_url"].includes(
            part.type
          )
      );
    }
  }
  return textResult;
}
