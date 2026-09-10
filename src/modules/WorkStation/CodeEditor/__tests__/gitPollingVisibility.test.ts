// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

import { trackGitPollingVisibility } from "../gitPollingVisibility";

it("clears the native owner while hidden and restores it once on return", () => {
  let hidden = false;
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockImplementation(() => (hidden ? "hidden" : "visible"));
  const report = vi.fn();
  const stop = trackGitPollingVisibility(document, "repo", report);
  expect(report).toHaveBeenLastCalledWith("repo");
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(report).toHaveBeenLastCalledWith(null);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(report).toHaveBeenLastCalledWith("repo");
  stop();
  expect(report).toHaveBeenLastCalledWith(null);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(report).toHaveBeenCalledTimes(4);
  visibility.mockRestore();
});
