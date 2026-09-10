/**
 * Project host context — Phase 2.1 of the WorkStation unified-tab migration.
 *
 * Publishes the Project host's action surface ABOVE the tab dispatcher so that
 * `UnifiedTabContent` renderers for project tab types can consume it directly,
 * instead of receiving it as props threaded through the content router.
 *
 * Actions belong to the host context; the content router only receives the
 * inputs it renders.
 *
 * See docs/workstation-unification/phase-2-host-hoist-plan.md (Phase 2.1).
 */
import { type ReactNode, createContext, useContext } from "react";

import type { QuickAction } from "@src/modules/WorkStation/shared";

import type { ProjectHostActions } from "../types";

export type ProjectHostContextValue = ProjectHostActions & {
  repoPath: string;
  projectQuickActions: QuickAction[];
  /** Repository name for display (sidebar/detail surfaces). */
  repoName: string;
};

const ProjectHostContext = createContext<ProjectHostContextValue | null>(null);

export function ProjectHostProvider({
  value,
  children,
}: {
  value: ProjectHostContextValue;
  children: ReactNode;
}) {
  return (
    <ProjectHostContext.Provider value={value}>
      {children}
    </ProjectHostContext.Provider>
  );
}

/**
 * Read the Project host context. Throws if used outside a `ProjectHostProvider`
 * — this guards against mounting a project renderer through the unified
 * dispatcher before the host context has been hoisted above it (which would
 * otherwise silently render a degraded surface).
 */
export function useProjectHostContext(): ProjectHostContextValue {
  const ctx = useContext(ProjectHostContext);
  if (ctx === null) {
    throw new Error(
      "useProjectHostContext must be used within a ProjectHostProvider"
    );
  }
  return ctx;
}
