// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitHubChecksSummary } from "@src/api/tauri/github";
import {
  BRANCH_CI_POLL_BASE_MS,
  BRANCH_CI_SAFETY_POLL_MS,
} from "@src/services/git/branchPullRequestStatus";
import {
  clearPullRequestHeadChecks,
  loadPullRequestHeadChecks,
} from "@src/services/git/pullRequestHeadChecks";
import {
  type PrIdentity,
  initialSelectedPrState,
  workstationPrScopeKey,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import { useWorkstationPrChecksPolling } from "../useWorkstationPrChecksPolling";

const apiMocks = vi.hoisted(() => ({
  getChecksLocal: vi.fn(),
  getPRLocal: vi.fn(),
}));
vi.mock("@src/api/tauri/github", () => apiMocks);

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const REPO = "org/repo";
const REPO_PATH = "/repo";
const HEAD = "head-sha";
const PR: PrIdentity = {
  number: 77,
  title: "Live checks",
  url: "https://github.com/org/repo/pull/77",
  status: "open",
  headBranch: "feat/live",
  baseBranch: "develop",
};
const OPEN_DETAIL = { state: "open", head: { sha: HEAD } };

function checksOf(status: "in_progress" | "completed"): GitHubChecksSummary {
  return {
    sha: HEAD,
    state: status === "completed" ? "success" : "pending",
    statuses: [],
    check_runs: [
      {
        id: 1,
        name: "test",
        status,
        conclusion: status === "completed" ? "success" : null,
        details_url: null,
        started_at: "2026-09-20T00:00:00Z",
        completed_at: status === "completed" ? "2026-09-20T00:01:00Z" : null,
        output_title: null,
        app_name: "CI",
      },
    ],
  };
}

type Store = ReturnType<typeof createStore>;
type Api = ReturnType<typeof useWorkstationPrChecksPolling>;

interface HarnessProps {
  pr: PrIdentity | null;
  apiRef: { current: Api | null };
  mountedRef: React.RefObject<boolean>;
  requestIdsRef: React.RefObject<Map<string, number>>;
  prActionPending: boolean;
  reconcile: (pr: PrIdentity) => void;
  visibilityRef?: React.RefObject<HTMLElement | null>;
}

function Harness({ apiRef, pr, ...rest }: HarnessProps): null {
  const result = useWorkstationPrChecksPolling({
    repoFullName: REPO,
    pr,
    scopeKey: workstationPrScopeKey(undefined, REPO_PATH, pr?.number),
    ...rest,
  });
  React.useEffect(() => {
    apiRef.current = result;
  });
  return null;
}

describe("useWorkstationPrChecksPolling", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: Store;
  let props: HarnessProps;
  const atomFor = (pr: PrIdentity = PR) =>
    workstationSelectedPrAtomFamily(
      workstationPrScopeKey(undefined, REPO_PATH, pr.number)
    );
  const shown = (pr?: PrIdentity) => store.get(atomFor(pr));

  function seed(
    pr: PrIdentity,
    checks: GitHubChecksSummary | null,
    detail: Record<string, unknown> = OPEN_DETAIL
  ): void {
    store.set(atomFor(pr), {
      ...initialSelectedPrState,
      identity: pr,
      detail,
      headSha: HEAD,
      checks,
    });
  }

  async function render(next: Partial<HarnessProps> = {}): Promise<void> {
    props = { ...props, ...next };
    await act(async () => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(Harness, props)
        )
      );
    });
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function setWindowHidden(hidden: boolean): void {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearPullRequestHeadChecks();
    apiMocks.getPRLocal.mockResolvedValue(OPEN_DETAIL);
    apiMocks.getChecksLocal.mockResolvedValue(checksOf("in_progress"));
    store = createStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      pr: PR,
      apiRef: { current: null },
      mountedRef: { current: true },
      requestIdsRef: { current: new Map() },
      prActionPending: false,
      reconcile: vi.fn(),
    };
    seed(PR, checksOf("in_progress"));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setWindowHidden(false);
    vi.useRealTimers();
  });

  it("keeps re-polling running checks with backoff, then cools to the safety interval once they settle", async () => {
    await render();

    await advance(BRANCH_CI_POLL_BASE_MS - 1);
    expect(apiMocks.getChecksLocal).not.toHaveBeenCalled();
    await advance(1);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(1);

    // Second poll waits twice as long.
    await advance(BRANCH_CI_POLL_BASE_MS * 2 - 1);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(1);
    apiMocks.getChecksLocal.mockResolvedValue(checksOf("completed"));
    await advance(1);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(2);
    expect(shown().checks?.state).toBe("success");
    expect(shown().refreshingChecks).toBe(false);

    await advance(BRANCH_CI_SAFETY_POLL_MS - 1);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(3);
  });

  it("keeps polling after a failed request instead of going quiet", async () => {
    apiMocks.getPRLocal.mockRejectedValueOnce(new Error("network"));
    await render();

    await advance(BRANCH_CI_POLL_BASE_MS);
    expect(apiMocks.getChecksLocal).not.toHaveBeenCalled();
    expect(shown().refreshingChecks).toBe(false);

    await advance(BRANCH_CI_POLL_BASE_MS * 2);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(1);
  });

  it("joins a manual refresh to the poll already in flight", async () => {
    let release: (value: Record<string, unknown>) => void = () => {};
    apiMocks.getPRLocal.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    await render();

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = props.apiRef.current?.refreshChecks();
      second = props.apiRef.current?.refreshChecks();
    });
    expect(second).toBe(first);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);
    expect(shown().refreshingChecks).toBe(true);

    await act(async () => {
      release(OPEN_DETAIL);
      await first;
    });
    expect(shown().refreshingChecks).toBe(false);
  });

  it("restarts the fast interval after a manual refresh", async () => {
    await render();
    await advance(BRANCH_CI_POLL_BASE_MS); // attempt 1 → next would be 30 s
    await act(async () => {
      await props.apiRef.current?.refreshChecks();
    });
    apiMocks.getChecksLocal.mockClear();

    await advance(BRANCH_CI_POLL_BASE_MS);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(1);
  });

  it("does not fetch while the window is hidden, and polls once when it returns", async () => {
    await render();
    setWindowHidden(true);

    await advance(BRANCH_CI_SAFETY_POLL_MS);
    expect(apiMocks.getPRLocal).not.toHaveBeenCalled();

    await act(async () => {
      setWindowHidden(false);
      await Promise.resolve();
    });
    await advance(0);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);
  });

  it("does not fetch while its panel sits in a background tab, and resumes when shown", async () => {
    const panel = document.createElement("div");
    let onScreen = false;
    panel.checkVisibility = () => onScreen;
    await render({ visibilityRef: { current: panel } });

    await advance(BRANCH_CI_POLL_BASE_MS * 4);
    expect(apiMocks.getPRLocal).not.toHaveBeenCalled();

    onScreen = true;
    await advance(BRANCH_CI_POLL_BASE_MS);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);
  });

  it("drops a result that lands after the selection moved to another pull request", async () => {
    const OTHER: PrIdentity = { ...PR, number: 78 };
    seed(OTHER, null, { state: "closed", merged: true, head: { sha: HEAD } });
    let release: (value: GitHubChecksSummary) => void = () => {};
    apiMocks.getChecksLocal.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    await render();
    await advance(BRANCH_CI_POLL_BASE_MS);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(1);

    await render({ pr: OTHER });
    await act(async () => {
      release(checksOf("completed"));
      await Promise.resolve();
    });

    expect(shown(PR).checks?.state).toBe("pending");
    expect(shown(OTHER).checks).toBeNull();
    expect(shown(OTHER).refreshingChecks).toBe(false);
  });

  it("stops every timer on unmount and ignores a late result", async () => {
    let release: (value: Record<string, unknown>) => void = () => {};
    apiMocks.getPRLocal.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    await render();
    await advance(BRANCH_CI_POLL_BASE_MS);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);

    props.mountedRef.current = false;
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      release(OPEN_DETAIL);
      await Promise.resolve();
    });
    await advance(BRANCH_CI_SAFETY_POLL_MS * 2);

    // The shared reader finishes its request — other surfaces may be waiting
    // on it — but this panel schedules nothing more and lands nothing.
    expect(vi.getTimerCount()).toBe(0);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);
    expect(shown().checks?.state).toBe("pending");
  });

  it("hands over to the full reconcile when the head commit moved", async () => {
    apiMocks.getPRLocal.mockResolvedValue({
      state: "open",
      head: { sha: "pushed-sha" },
    });
    apiMocks.getChecksLocal.mockResolvedValue(checksOf("completed"));
    await render();
    await advance(BRANCH_CI_POLL_BASE_MS);

    // The new head's checks are not patched onto the old head's panel.
    expect(props.reconcile).toHaveBeenCalledWith(PR);
    expect(shown().headSha).toBe(HEAD);
    expect(shown().checks?.state).toBe("pending");
  });

  it("drops its result when a full load started after it was dispatched", async () => {
    let release: (value: GitHubChecksSummary) => void = () => {};
    apiMocks.getChecksLocal.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    await render();
    await advance(BRANCH_CI_POLL_BASE_MS);

    props.requestIdsRef.current.set(`${REPO}#${PR.number}`, 1);
    await act(async () => {
      release(checksOf("completed"));
      await Promise.resolve();
    });
    expect(shown().checks?.state).toBe("pending");
  });

  it("lands fresh merge state with the checks, but never over an in-flight mutation's optimistic detail", async () => {
    apiMocks.getChecksLocal.mockResolvedValue(checksOf("completed"));
    apiMocks.getPRLocal.mockResolvedValue({
      ...OPEN_DETAIL,
      mergeable_state: "clean",
    });

    await render({ prActionPending: true });
    await advance(BRANCH_CI_POLL_BASE_MS);
    expect(shown().checks?.state).toBe("success");
    expect(shown().detail).toBe(OPEN_DETAIL);

    await render({ prActionPending: false });
    await act(async () => {
      await props.apiRef.current?.refreshChecks();
    });
    expect(shown().detail).toMatchObject({ mergeable_state: "clean" });
  });

  it("asks GitHub once per interval when two panels show the same pull request", async () => {
    // A second panel on the same pull request, with its own state (another
    // repo id) and its own timer, started 4 s later.
    const otherScope = workstationPrScopeKey(
      "second-pane",
      REPO_PATH,
      PR.number
    );
    const otherAtom = workstationSelectedPrAtomFamily(otherScope);
    store.set(otherAtom, {
      ...initialSelectedPrState,
      identity: PR,
      detail: OPEN_DETAIL,
      headSha: HEAD,
      checks: checksOf("in_progress"),
    });
    function SecondPanel(): null {
      useWorkstationPrChecksPolling({
        repoFullName: REPO,
        pr: PR,
        scopeKey: otherScope,
        mountedRef: props.mountedRef,
        requestIdsRef: props.requestIdsRef,
        prActionPending: false,
        reconcile: props.reconcile,
      });
      return null;
    }
    const secondContainer = document.createElement("div");
    const secondRoot = createRoot(secondContainer);

    await render();
    await advance(4_000);
    await act(async () => {
      secondRoot.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(SecondPanel)
        )
      );
    });

    apiMocks.getChecksLocal.mockResolvedValue(checksOf("completed"));
    // First panel fires at 15 s; the second would have fired at 19 s.
    await advance(BRANCH_CI_POLL_BASE_MS);

    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);
    expect(shown().checks?.state).toBe("success");
    expect(store.get(otherAtom).checks?.state).toBe("success");

    act(() => secondRoot.unmount());
  });

  it("lands an answer the status bar fetched and restarts its own timer", async () => {
    await render();
    await advance(BRANCH_CI_POLL_BASE_MS - 1_000);

    await act(async () => {
      await loadPullRequestHeadChecks(REPO, PR.number, {
        source: "status-bar",
      });
    });
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);

    // Its own poll was 1 s away; it now waits a full interval from the answer.
    await advance(BRANCH_CI_POLL_BASE_MS - 1);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(2);
  });

  it("does not poll a merged pull request", async () => {
    seed(PR, checksOf("in_progress"), {
      state: "closed",
      merged: true,
      head: { sha: HEAD },
    });
    await render();

    await advance(BRANCH_CI_SAFETY_POLL_MS * 2);
    expect(apiMocks.getPRLocal).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
