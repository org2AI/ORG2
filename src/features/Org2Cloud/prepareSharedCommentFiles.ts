import { open, stat } from "@tauri-apps/plugin-fs";

import { type CloudEndpoint } from "./config";
import { CLOUD_COMMENT_MAX_BODY_LENGTH } from "./org2CloudCommentsClient";
import {
  buildSharedSessionFileReference,
  parseSharedSessionFileReference,
} from "./sharedSessionFileReference";
import {
  SHARED_FILE_MAX_BYTES,
  uploadSharedSessionFile,
} from "./sharedSessionFilesClient";

/** Read through a bounded handle, including when a file grows after stat. */
export async function readBoundedFile(path: string): Promise<Uint8Array> {
  const info = await stat(path);
  if (!info.isFile || info.size > SHARED_FILE_MAX_BYTES)
    throw new Error("Only files up to 32 MiB can be shared");
  const handle = await open(path, { read: true });
  try {
    const bytes = new Uint8Array(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = await handle.read(bytes.subarray(length));
      if (!count) break;
      length += count;
    }
    if (length > SHARED_FILE_MAX_BYTES)
      throw new Error("Shared file exceeds 32 MiB");
    const after = await stat(path);
    if (
      length !== info.size ||
      after.size !== info.size ||
      after.mtime?.getTime() !== info.mtime?.getTime()
    )
      throw new Error("File changed while being shared; retry the upload");
    return bytes.slice(0, length);
  } finally {
    await handle.close();
  }
}
/** Only explicit composer file references are uploaded. Never scan the workspace. */
export async function prepareSharedCommentFiles(input: {
  body: string;
  token: string;
  endpoint: CloudEndpoint;
  orgId: string;
  sessionId: string;
  assertCurrentIdentity: () => void;
}): Promise<string> {
  const matches = [...input.body.matchAll(/\[file:([^\]\r\n]+)\]/g)];
  const paths = [...new Set(matches.map((match) => match[1]))];
  const replacements = new Map<string, string>();
  for (const path of paths) {
    if (parseSharedSessionFileReference(path)) {
      replacements.set(path, `[Shared file](${path})`);
      continue;
    }
    input.assertCurrentIdentity();
    // Remote paths must never be interpreted as local files or uploaded implicitly.
    if (!/^(?:\/|[A-Za-z]:[\\/])/.test(path))
      throw new Error(
        "Shared file references need an absolute local file path"
      );
    const bytes = await readBoundedFile(path);
    input.assertCurrentIdentity();
    const name = path.split(/[\\/]/).pop() || "file";
    const file = await uploadSharedSessionFile(
      input.token,
      input.endpoint,
      input.orgId,
      input.sessionId,
      name,
      bytes
    );
    input.assertCurrentIdentity();
    const href = buildSharedSessionFileReference(
      file.id,
      input.endpoint.supabaseUrl
    );
    replacements.set(path, `[${name.replace(/[\\[\]]/g, "\\$&")}](${href})`);
  }
  let body = "";
  let cursor = 0;
  for (const match of matches) {
    let prefix = input.body.slice(cursor, match.index);
    const name = match[1].split(/[\\/]/).pop() || "file";
    // The composer includes a visible filename immediately before its token.
    // The Markdown link supplies that same label; do not display it twice.
    if (prefix.endsWith(`${name} `)) prefix = prefix.slice(0, -name.length - 1);
    body += prefix + replacements.get(match[1]);
    cursor = match.index! + match[0].length;
  }
  body += input.body.slice(cursor);
  if (body.length > CLOUD_COMMENT_MAX_BODY_LENGTH)
    throw new Error("Comment with shared file links exceeds 4000 characters");
  return body;
}
