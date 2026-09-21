use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Default)]
struct FileChangeStats {
    files: BTreeSet<String>,
    lines_added: i32,
    lines_removed: i32,
}

use crate::canonical::{CommitLinkRecord, SessionFinalDiffRecord, SessionRecord};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreSessionSummary {
    pub session_id: String,
    pub title: String,
    pub source: String,
    pub workspace_path: Option<String>,
    pub files_changed: usize,
    pub lines_added: i32,
    pub lines_removed: i32,
    pub related_commits: usize,
    pub committed_rate_percent: usize,
    pub model: Option<String>,
    pub key_source: Option<String>,
}

impl CoreSessionSummary {
    /// Overlay the impact an imported session's source parser recorded.
    /// Imported sources have no live orgtrack diff writer — their final-diff
    /// rows are leftovers of the removed on-demand analysis, never refreshed —
    /// while the parser tally is re-derived on every rescan. A recorded tally
    /// therefore wins; an empty one leaves the diff projection untouched.
    pub fn overlay_source_impact(
        &mut self,
        files_changed: i64,
        lines_added: i64,
        lines_removed: i64,
    ) {
        if files_changed <= 0 && lines_added <= 0 && lines_removed <= 0 {
            return;
        }
        let clamp_lines = |lines: i64| lines.clamp(0, i64::from(i32::MAX)) as i32;
        self.files_changed = usize::try_from(files_changed).unwrap_or(0);
        self.lines_added = clamp_lines(lines_added);
        self.lines_removed = clamp_lines(lines_removed);
    }
}

pub fn session_summaries(
    sessions: Vec<SessionRecord>,
    final_diffs: Vec<SessionFinalDiffRecord>,
    commit_links: Vec<CommitLinkRecord>,
) -> Vec<CoreSessionSummary> {
    let mut stats_by_session: BTreeMap<String, FileChangeStats> = BTreeMap::new();
    for final_diff in final_diffs {
        let stats = stats_by_session.entry(final_diff.session_id).or_default();
        stats.files.insert(final_diff.file_path);
        stats.lines_added += final_diff.lines_added;
        stats.lines_removed += final_diff.lines_removed;
    }

    let mut commits_by_session: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for link in commit_links {
        for session_id in link.session_ids {
            commits_by_session
                .entry(session_id)
                .or_default()
                .insert(link.commit_sha.clone());
        }
    }

    sessions
        .into_iter()
        .map(|session| {
            let stats = stats_by_session.get(&session.session_id);
            let related_commits = commits_by_session
                .get(&session.session_id)
                .map(BTreeSet::len)
                .unwrap_or(0);
            let files_changed = stats.map(|stats| stats.files.len()).unwrap_or(0);
            CoreSessionSummary {
                session_id: session.session_id,
                title: session.title,
                source: session.source,
                workspace_path: session.workspace_path,
                files_changed,
                lines_added: stats.map(|stats| stats.lines_added).unwrap_or(0),
                lines_removed: stats.map(|stats| stats.lines_removed).unwrap_or(0),
                related_commits,
                committed_rate_percent: 0,
                model: session.metadata.model,
                key_source: session.metadata.key_source,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(files_changed: usize, lines_added: i32, lines_removed: i32) -> CoreSessionSummary {
        CoreSessionSummary {
            session_id: "claudecodeapp-1".to_string(),
            title: "Session".to_string(),
            source: "claude_code".to_string(),
            workspace_path: None,
            files_changed,
            lines_added,
            lines_removed,
            related_commits: 1,
            committed_rate_percent: 0,
            model: None,
            key_source: None,
        }
    }

    #[test]
    fn source_impact_replaces_stale_final_diff_tallies() {
        let mut stale = summary(1, 9, 9);
        stale.overlay_source_impact(5, 4, 3);
        assert_eq!(
            (stale.files_changed, stale.lines_added, stale.lines_removed),
            (5, 4, 3)
        );
        assert_eq!(stale.related_commits, 1);
    }

    #[test]
    fn empty_source_impact_keeps_the_diff_projection() {
        let mut projected = summary(2, 7, 1);
        projected.overlay_source_impact(0, 0, 0);
        assert_eq!(
            (
                projected.files_changed,
                projected.lines_added,
                projected.lines_removed
            ),
            (2, 7, 1)
        );
    }

    #[test]
    fn source_impact_clamps_out_of_range_counts() {
        let mut clamped = summary(0, 0, 0);
        clamped.overlay_source_impact(-1, i64::MAX, 2);
        assert_eq!(clamped.files_changed, 0);
        assert_eq!(clamped.lines_added, i32::MAX);
        assert_eq!(clamped.lines_removed, 2);
    }
}
