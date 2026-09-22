/**
 * GitHub repository shapes shared between the Tauri api layer and
 * `types/githubDetail` (tab payloads).
 */

export interface GitHubRepoPermissions {
  role_name: string | null;
  can_manage_issues: boolean;
  can_manage_pull_requests: boolean;
}
