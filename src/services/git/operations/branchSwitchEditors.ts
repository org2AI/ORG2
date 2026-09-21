/** Mounted editor ownership for the awaited branch-switch save barrier. */
export interface SwitchEditor {
  path: string;
  dirty: () => boolean;
  save: () => Promise<void>;
}
const editors = new Set<SwitchEditor>();
export function registerBranchSwitchEditor(editor: SwitchEditor): () => void {
  editors.add(editor);
  return () => {
    editors.delete(editor);
  };
}
export function isWithinWorktree(path: string, root: string): boolean {
  const windowsPath = /^[a-z]:[\\/]/i.test(root);
  if (windowsPath) {
    path = path.toLowerCase();
    root = root.toLowerCase();
  }
  const normalized = root.replace(/\\/g, "/").replace(/\/$/, "");
  const file = path.replace(/\\/g, "/");
  return file === normalized || file.startsWith(`${normalized}/`);
}
export function switchEditors(root: string): SwitchEditor[] {
  return [...editors].filter((e) => isWithinWorktree(e.path, root));
}
