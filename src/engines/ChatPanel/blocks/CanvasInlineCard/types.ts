/**
 * Canvas inline-card shapes.
 *
 * The declarations moved down to `@src/contracts/chat/canvasInline` so
 * `store/session/canvasPreviewAtom` can name them without importing
 * `engines/`. This module stays as the CanvasInlineCard-facing facade.
 */

export * from "@src/contracts/chat/canvasInline";
