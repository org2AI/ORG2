import AnyIcon from "@src/components/AnyIcon";
import FileTypeIcon from "@src/components/FileTypeIcon";
import ModelIcon from "@src/components/ModelIcon";
import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { SessionSourceThumbnail } from "./SessionSourceThumbnail";
import { sourceIcon } from "./presentation";

/** Resource identity is shared by compact rows and tool-group headings. */
export function SessionSourceIcon({
  source,
  size = 14,
}: {
  source: SessionSource;
  size?: number;
}) {
  if (source.kind === "image")
    return <SessionSourceThumbnail imageRef={source.ref} size={size} />;
  if (source.kind === "file" && !source.isDirectory)
    return (
      <FileTypeIcon
        fileName={source.fileName}
        size={size <= 14 ? "small" : size <= 16 ? "medium" : "large"}
      />
    );
  if (source.kind === "tool-group" && source.group === "codex-app")
    return <ModelIcon provider="openai" size={size} />;
  return <AnyIcon icon={sourceIcon(source)} size={size} />;
}
