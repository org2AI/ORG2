import { writeTextFile } from "@tauri-apps/plugin-fs";

import { toFsPluginPath } from "@src/util/file/pathUtils";

// One FIFO per target. A rejected write must not poison the next save, and
// finished files must not remain retained for the app lifetime.
const writes = new Map<string, Promise<void>>();
const MAX_PENDING_FILES = 128;
let pendingCount = 0;

export function writeTextFileSerial(
  path: string,
  content: string
): Promise<void> {
  return updateTextFileSerial(path, async () => content);
}

/** Read/modify/write operations share the same target queue as editor saves. */
export function updateTextFileSerial(
  path: string,
  getContent: (target: string) => Promise<string>
): Promise<void> {
  const target = toFsPluginPath(path);
  const previous = writes.get(target);
  if (pendingCount >= MAX_PENDING_FILES) {
    return Promise.reject(
      new Error(
        "Too many files are being saved; retry after pending saves finish"
      )
    );
  }
  pendingCount += 1;
  const pending = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => writeTextFile(target, await getContent(target)));
  writes.set(target, pending);
  void pending
    .finally(() => {
      pendingCount -= 1;
      if (writes.get(target) === pending) writes.delete(target);
    })
    .catch(() => undefined);
  return pending;
}
