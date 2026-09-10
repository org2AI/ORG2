// @vitest-environment jsdom
import { Provider, atom, createStore } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type CreateProjectView from "@src/modules/ProjectManager/Projects/components/CreateProjectView";
import type CreateWorkItemView from "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView";
import type { ManualCreatorRequest } from "@src/store/ui/manualCreatorAtom";
import type { Project } from "@src/types/core/project";
import type { WorkItem } from "@src/types/core/workItem";

import ManualSpotlightCreator from "./ManualSpotlightCreator";

const mocks = vi.hoisted(() => ({
  projectProps: null as React.ComponentProps<typeof CreateProjectView> | null,
  workItemProps: null as React.ComponentProps<typeof CreateWorkItemView> | null,
  openProject: vi.fn(),
  openWorkItem: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "@src/modules/ProjectManager/Projects/components/CreateProjectView",
  () => ({
    default: (props: React.ComponentProps<typeof CreateProjectView>) => {
      mocks.projectProps = props;
      return null;
    },
  })
);
vi.mock(
  "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView",
  () => ({
    default: (props: React.ComponentProps<typeof CreateWorkItemView>) => {
      mocks.workItemProps = props;
      return null;
    },
  })
);
vi.mock("@src/store/chatPanel/chatPanelTabsAtom", () => ({
  openProjectInChatPanelTabAtom: atom(null, (_get, _set, value) =>
    mocks.openProject(value)
  ),
  openWorkItemInChatPanelTabAtom: atom(null, (_get, _set, value) =>
    mocks.openWorkItem(value)
  ),
}));
vi.mock("@src/store/workspace", () => ({
  primaryWorkspaceRootAtom: atom({ path: "/repo", name: "Repo" }),
}));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function render(target: ManualCreatorRequest["target"]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  act(() =>
    root.render(
      React.createElement(
        Provider,
        { store: createStore() },
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(ManualSpotlightCreator, {
            request: {
              target,
              createProjectContext: {
                orgId: "org-a",
                scopeBreadcrumbLabel: "Team A",
              },
            },
            onClose: close,
          })
        )
      )
    )
  );
  let unmounted = false;
  const unmount = () => {
    if (!unmounted) {
      act(() => root.unmount());
      unmounted = true;
    }
  };
  cleanups.push(() => {
    unmount();
    host.remove();
  });
  return { close, host, unmount };
}

describe("ManualSpotlightCreator", () => {
  it("renders a manual scoped work item and supports cancel and create another", () => {
    const { close } = render("workItem");
    expect(
      document.querySelector('[data-testid="manual-spotlight-creator"]')
    ).not.toBeNull();
    expect(mocks.workItemProps).toMatchObject({
      layout: "spotlight",
      orgId: "org-a",
      repoPath: "/repo",
    });
    mocks.workItemProps!.onWorkItemCreated({
      shortId: "WI-1",
      orgId: "org-a",
      keepOpen: true,
    });
    expect(close).not.toHaveBeenCalled();
    expect(mocks.openWorkItem).not.toHaveBeenCalled();
    act(() => mocks.workItemProps!.onCancel());
    expect(close).toHaveBeenCalledOnce();
  });

  it("opens the created work item with its organization", () => {
    const { close } = render("workItem");
    mocks.workItemProps!.onWorkItemCreated({
      shortId: "WI-1",
      orgId: "org-a",
      workItem: { session_id: "wi-1" } as WorkItem,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.openWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        shortId: "WI-1",
        orgId: "org-a",
        orgName: "Team A",
      })
    );
  });

  it("opens the successfully created project", () => {
    const { close } = render("project");
    const result = {
      project: { id: "p-1" } as Project,
      projectSlug: "p-1",
      orgId: "org-a",
    };
    mocks.projectProps!.onProjectCreated!(result);
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.openProject).toHaveBeenCalledWith(result);
  });

  it("carries project scope and ignores a completion after the modal unmounts", () => {
    const { close, unmount } = render("project");
    expect(mocks.projectProps!.onCancel).toBe(close);
    expect(mocks.projectProps).toMatchObject({
      layout: "spotlight",
      orgId: "org-a",
      repoPath: "/repo",
    });
    const completed = mocks.projectProps!.onProjectCreated!;
    unmount();
    completed({
      project: { id: "p-1" } as Project,
      projectSlug: "p-1",
      orgId: "org-a",
    });
    expect(close).not.toHaveBeenCalled();
    expect(mocks.openProject).not.toHaveBeenCalled();
  });
});
