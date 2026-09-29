import { createGitHubPrDetailTab } from "@src/store/workstation/tabs/factories/githubPr";
import type { GitHubPrDetailTabData } from "@src/types/githubDetail";
import { revealMyStation } from "@src/util/ui/revealMyStation";

import { EditorTabService } from "./EditorTabService";

/** Open beside the conversation, preserving the selected chat and its draft. */
export function openPullRequestTab(pr: GitHubPrDetailTabData): void {
  EditorTabService.openTab(createGitHubPrDetailTab(pr));
  revealMyStation();
}
