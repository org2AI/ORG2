/**
 * Session-creator contracts.
 *
 * Shapes that `store/session/*` drafts persist and `features/SessionCreator`
 * renders. Pure data only — the creator's config, validation and launch
 * behavior stay in `features/SessionCreator`.
 */

/** One file staged on a session-creator draft before launch. */
export interface UploadedFile {
  id: string;
  name: string;
  type: "text" | "image" | "document" | "folder";
  file?: File;
  /** File path for Tauri drops (used for image preview) */
  path?: string;
}
