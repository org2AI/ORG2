// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { findPullRequestLocal } from "@src/api/tauri/github";
import type { LocalFindPRResponse } from "@src/api/tauri/github";
import { clearBranchPullRequestStatusCache } from "@src/services/git/branchPullRequestStatus";

import { useBranchPullRequestStatus } from "./useBranchPullRequestStatus";

vi.mock("@src/api/http/git/branches", () => ({
  getGitDefaultBranch: vi.fn(async () => ({ name: "main" })),
}));
vi.mock("@src/api/http/git/remotes", () => ({
  getGitRemotes: vi.fn(async () => ({
    remotes: [{ name: "origin", url: "git@github.com:acme/repo.git" }],
  })),
}));
vi.mock("@src/api/tauri/github", () => ({
  findPullRequestLocal: vi.fn(),
  getGitCredentialForRemote: vi.fn(async () => null),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function summary(number: number): LocalFindPRResponse {
  return {
    number,
    state: "merged",
    url: `https://github.com/acme/repo/pull/${number}`,
    title: `Summary ${number}`,
  };
}
function Probe({ branch }: { branch: string }) {
  const state = useBranchPullRequestStatus({
    repoPath: "/fixture/repo",
    branchName: branch,
    includeClosed: true,
  });
  return createElement("output", null, state.pr?.title ?? "No PR");
}

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  clearBranchPullRequestStatusCache();
  vi.clearAllMocks();
  Reflect.deleteProperty(reactEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});
function mount() {
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

describe("conversation PR lifecycle", () => {
  it("rejects a late response from the previous conversation branch", async () => {
    const oldResponse = deferred<LocalFindPRResponse>();
    const newResponse = deferred<LocalFindPRResponse>();
    vi.mocked(findPullRequestLocal).mockImplementation((_repo, branch) =>
      branch === "previous" ? oldResponse.promise : newResponse.promise
    );
    const { container, root } = mount();
    await act(async () => {
      root.render(createElement(Probe, { branch: "previous" }));
    });
    await act(async () => {
      root.render(createElement(Probe, { branch: "current" }));
    });
    expect(findPullRequestLocal).toHaveBeenCalledTimes(2);
    await act(async () => {
      newResponse.resolve(summary(22));
    });
    expect(container.textContent).toBe("Summary 22");
    await act(async () => {
      oldResponse.resolve(summary(11));
    });
    expect(container.textContent).toBe("Summary 22");
  });

  it("coalesces equivalent summary readers across mounted surfaces", async () => {
    const response = deferred<LocalFindPRResponse>();
    vi.mocked(findPullRequestLocal).mockReturnValue(response.promise);
    const first = mount();
    const second = mount();
    await act(async () => {
      first.root.render(createElement(Probe, { branch: "current" }));
      second.root.render(createElement(Probe, { branch: "current" }));
    });
    expect(findPullRequestLocal).toHaveBeenCalledTimes(1);
    await act(async () => {
      response.resolve(summary(22));
    });
    expect(first.container.textContent).toBe("Summary 22");
    expect(second.container.textContent).toBe("Summary 22");
  });
});
