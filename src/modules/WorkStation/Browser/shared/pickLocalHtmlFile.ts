import { open } from "@tauri-apps/plugin-dialog";

import { localPathToFileUrl } from "@src/util/url/localFileUrl";

const HTML_FILE_FILTER = {
  name: "HTML",
  extensions: ["html", "htm", "xhtml"],
};

/**
 * Ask the user for a local HTML file and return the `file://` URL the browser
 * webview can navigate to. Resolves to `null` when they cancel.
 */
export async function pickLocalHtmlFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [HTML_FILE_FILTER],
  });
  if (typeof selected !== "string") return null;

  const fileUrl = localPathToFileUrl(selected);
  if (!fileUrl) {
    throw new Error(`Not an absolute file path: ${selected}`);
  }
  return fileUrl;
}
