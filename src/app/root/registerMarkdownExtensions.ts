/**
 * Wire the Markdown renderer's extension slots at app bootstrap.
 *
 * `components/MarkDown/` is a tier-1 primitive with 51 importers across 12
 * areas, so it declares slots instead of importing the tiers that fill them.
 * This is the one place that knows about both sides: the composition root.
 *
 * Every slot degrades to a plain default, so a window that never reaches this
 * module still renders readable Markdown — code fences, images and links all
 * work, they just lose the chat chrome and the cloud-reference affordances.
 *
 * Kept synchronous and evaluated at module load (imported by `AppBootstrap`),
 * so the slots are filled before React renders anything. The modules imported
 * here are already in the startup graph, except `themes/prism`, which is a
 * dependency-free style map.
 */
import { registerMarkdownExtensions } from "@src/components/MarkDown/extensions";
import { chatPanelMarkdownExtensions } from "@src/engines/ChatPanel/markdown/chatMarkdownExtensions";
import { codeMirrorPrismTheme } from "@src/features/CodeMirror/themes/prism";
import { org2CloudMarkdownExtensions } from "@src/features/Org2Cloud/markdown/cloudMarkdownExtensions";
import ImagePreviewOverlay from "@src/scaffold/ImagePreviewOverlay";

let registered = false;

/** Idempotent: secondary windows evaluate this module in their own realm. */
export function registerAppMarkdownExtensions(): void {
  if (registered) return;
  registered = true;
  registerMarkdownExtensions({
    ...chatPanelMarkdownExtensions,
    ...org2CloudMarkdownExtensions,
    ImageOverlay: ImagePreviewOverlay,
    syntaxTheme: codeMirrorPrismTheme,
  });
}
