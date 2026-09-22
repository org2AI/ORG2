import type { ReactNode } from "react";

import { FileTreeHoverPreview } from "@src/components/FileTreePreview/exports";
import { useIsSessionFileShared } from "@src/features/Org2Cloud/SharedSessionFilesContext";

interface EventFileHoverPreviewProps {
  path?: string | null;
  repoPath?: string;
  children: ReactNode;
}

const EventFileHoverPreview: React.FC<EventFileHoverPreviewProps> = ({
  path,
  repoPath,
  children,
}) => {
  const shared = useIsSessionFileShared();
  if (!path || shared) return children;

  return (
    <FileTreeHoverPreview
      path={path}
      itemType="file"
      repoPath={repoPath}
      as="div"
      display="block"
      placement="bottom"
    >
      {children}
    </FileTreeHoverPreview>
  );
};

EventFileHoverPreview.displayName = "EventFileHoverPreview";

export default EventFileHoverPreview;
