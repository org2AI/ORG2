/**
 * Renderer wrapper for `git-log` tabs (git error-log viewer).
 *
 * Synthesises the multi-line error banner from
 * `tab.data.operation/errorMessage/commandOutput` and pipes it into a read-only
 * `CodeViewerContent` — a 1:1 mirror of `TabContentRenderer`'s `case "git-log"`.
 * Self-contained: it derives everything from `tab.data` and needs no host
 * context (the read-only viewer takes `repoPath=""`).
 */
import { createLazyTabRenderer } from "./createLazyTabRenderer";

function buildGitErrorLog(data: Record<string, unknown>): string {
  const operation = String(data.operation || "unknown");
  const errorMessage = String(data.errorMessage || "");
  const commandOutput = data.commandOutput
    ? String(data.commandOutput)
    : undefined;
  const timestamp = data.timestamp ? String(data.timestamp) : undefined;

  const errorTime = timestamp ? new Date(timestamp) : new Date();
  const lines: string[] = [
    `═══════════════════════════════════════════════════════════════`,
    `  Git ${operation.charAt(0).toUpperCase() + operation.slice(1)} Failed`,
    `  ${errorTime.toLocaleString()}`,
    `═══════════════════════════════════════════════════════════════`,
    ``,
    `Message:`,
    `─────────────────────────────────────────────────────────────────`,
    errorMessage,
    `─────────────────────────────────────────────────────────────────`,
    ``,
  ];
  if (commandOutput && commandOutput !== errorMessage) {
    lines.push(
      `Command Output:`,
      `─────────────────────────────────────────────────────────────────`,
      commandOutput,
      `─────────────────────────────────────────────────────────────────`
    );
  }
  return lines.join("\n");
}

const GitLogTabRenderer = createLazyTabRenderer({
  displayName: "GitLogTabRenderer",
  load: () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/CodeViewerContent"),
  useProps: ({ tab }) => ({
    selectedFile: String(tab.data.virtualFileName || tab.title || "git-error"),
    fileContent: buildGitErrorLog(tab.data),
    loading: false,
    error: null,
    repoPath: "",
    readOnly: true,
  }),
});

export default GitLogTabRenderer;
