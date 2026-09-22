// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { createElement } from "react";
import { expect, it, vi } from "vitest";

import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import { useBranchFetch } from "../useBranchFetch";

const github = vi.hoisted(() => ({
  getBranchesForRepo: vi.fn(),
  branchesCache: new Map(),
}));
vi.mock("@src/hooks/git", () => ({ useGitHubConnections: () => github }));
vi.mock("@src/api/http/git", () => ({ gitApi: { getGitBranches: vi.fn() } }));
function deferred() {
  let resolve!: (value: { name: string; is_default: boolean }[]) => void;
  const promise = new Promise<{ name: string; is_default: boolean }[]>(
    (done) => {
      resolve = done;
    }
  );
  return { promise, resolve };
}

it("keeps the new GitHub scope when an old connection resolves last, and ignores closed requests", async () => {
  const old = deferred(),
    fresh = deferred(),
    closed = deferred();
  github.getBranchesForRepo
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise)
    .mockReturnValueOnce(closed.promise);
  const store = createStore();
  function View({ connection, open }: { connection: string; open: boolean }) {
    const result = useBranchFetch({
      isOpen: open,
      repoId: connection,
      repoPath: "",
      isGitHubRepo: true,
      githubConnectionId: connection,
      githubRepoFullName: "owner/repo",
    });
    return createElement(
      "div",
      null,
      result.branches.map((row) => row.name).join(",")
    );
  }
  const root = createSmokeRoot();
  const render = (connection: string, open = true) =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(View, { connection, open })
      )
    );
  try {
    await render("a");
    await render("b");
    await dispatch(() => fresh.resolve([{ name: "new", is_default: true }]));
    expect(root.container.textContent).toBe("new");
    await dispatch(() => old.resolve([{ name: "old", is_default: true }]));
    expect(root.container.textContent).toBe("new");
    await render("c");
    await render("c", false);
    await dispatch(() =>
      closed.resolve([{ name: "closed", is_default: true }])
    );
    expect(root.container.textContent).not.toContain("closed");
  } finally {
    await root.unmount();
  }
});
