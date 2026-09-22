/** Called directly from a user gesture in both Safari and the iOS WebView. */
export async function writeClipboardText(text: string): Promise<void> {
  if (globalThis.navigator.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }

  // Older WebViews lack the async API. Keep the fallback synchronous so the
  // original user gesture remains valid, and always restore focus/selection.
  const document = globalThis.document;
  const focused = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : [];
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand("copy"))
      throw new Error("Clipboard write failed");
  } finally {
    textarea.remove();
    focused?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
