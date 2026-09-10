import { useAtomValue, useSetAtom } from "jotai";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { workItemDataToUI } from "@src/api/http/project";
import CreateProjectView from "@src/modules/ProjectManager/Projects/components/CreateProjectView";
import CreateWorkItemView from "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView";
import { SpotlightShell } from "@src/scaffold/GlobalSpotlight/shell/SpotlightShell";
import {
  openProjectInChatPanelTabAtom,
  openWorkItemInChatPanelTabAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import { projectListRefreshAtom } from "@src/store/project/projectAtom";
import type { ManualCreatorRequest } from "@src/store/ui/manualCreatorAtom";
import { primaryWorkspaceRootAtom } from "@src/store/workspace";
import { MANUAL_PROJECT_CREATOR_DRAFT_ID } from "@src/store/workstation/projectManager";

const ignoreUnsaved = () => undefined;

export default function ManualSpotlightCreator({
  request,
  onClose,
}: {
  request: ManualCreatorRequest;
  onClose: () => void;
}) {
  const { t } = useTranslation("projects");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const workspace = useAtomValue(primaryWorkspaceRootAtom);
  const openProject = useSetAtom(openProjectInChatPanelTabAtom);
  const openWorkItem = useSetAtom(openWorkItemInChatPanelTabAtom);
  const refreshProjects = useSetAtom(projectListRefreshAtom);
  const context = request.createProjectContext;
  const title = t(
    request.target === "project"
      ? "projects.newProject"
      : "workItems.newWorkItem"
  );

  return (
    <SpotlightShell isOpen onClose={onClose} hideFooter>
      <section
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="px-4 pt-4 pb-2 text-sm font-medium text-text-1">
          {title}
        </div>
        <div className="pb-4" data-testid="manual-spotlight-creator">
          {request.target === "project" ? (
            <CreateProjectView
              tabId={MANUAL_PROJECT_CREATOR_DRAFT_ID}
              layout="spotlight"
              orgId={context?.orgId}
              scopeBreadcrumbLabel={context?.scopeBreadcrumbLabel}
              repoPath={workspace?.path}
              repoName={workspace?.name}
              onSetUnsaved={ignoreUnsaved}
              onCancel={onClose}
              onProjectCreated={(result) => {
                refreshProjects((value) => value + 1);
                if (!mounted.current) return;
                onClose();
                openProject(result);
              }}
            />
          ) : (
            <CreateWorkItemView
              layout="spotlight"
              aiGenerateMode={false}
              orgId={context?.orgId}
              repoPath={workspace?.path}
              onSetUnsaved={ignoreUnsaved}
              onCancel={onClose}
              onWorkItemCreated={(result) => {
                if (!mounted.current || !result || result.keepOpen) return;
                const workItem =
                  result.workItem ??
                  (result.item
                    ? workItemDataToUI(result.item, {
                        labelMap: new Map(),
                        memberMap: new Map(),
                      })
                    : null);
                if (!workItem) return;
                onClose();
                openWorkItem({
                  workItem,
                  shortId: result.shortId,
                  projectSlug: result.projectSlug ?? "",
                  projectId:
                    result.item?.frontmatter.project ??
                    workItem.project?.id ??
                    "",
                  projectName: workItem.project?.name ?? "",
                  orgId: result.orgId,
                  orgName:
                    result.orgId === context?.orgId
                      ? context?.scopeBreadcrumbLabel
                      : undefined,
                });
              }}
            />
          )}
        </div>
      </section>
    </SpotlightShell>
  );
}
