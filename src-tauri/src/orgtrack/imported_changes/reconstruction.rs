//! Replay recorded file edits, never the current filesystem. A full creation is
//! an anchor; a fragment alone is not. Unknown edits or ambiguous context break
//! the chain until another full creation. All limits are per selected file.
use core_types::session_event::SessionEvent;

const MAX_FILE_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct RecordedEdit {
    pub event_id: String,
    pub paths: Vec<String>,
    pub patch: Option<String>,
}

impl RecordedEdit {
    pub fn from_event(event: &SessionEvent, paths: Vec<String>) -> Self {
        Self {
            // Display IDs include reader-relative sequence numbers. The
            // provider call ID remains stable across paginated/full reads.
            event_id: event.call_id.clone().unwrap_or_else(|| event.id.clone()),
            paths,
            patch: event
                .args
                .get("patch_text")
                .or_else(|| event.args.get("patch"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct FileVersion {
    pub before: Option<String>,
    pub after: Option<String>,
}

/// `range` uses exact authoritative event identities, not timestamps/titles or
/// indices from a separately paginated transcript. Later edits are never read
/// into the selected version. A missing boundary yields no version.
pub(crate) fn replay(
    history: &[RecordedEdit],
    path: &str,
    range: Option<(&str, &str)>,
    initial: Option<String>,
) -> FileVersion {
    let edits: Vec<_> = history
        .iter()
        .filter(|e| e.paths.iter().any(|p| p == path))
        .collect();
    let (first, last) = match range {
        Some((first, last)) => match (
            edits.iter().position(|e| e.event_id == first),
            edits.iter().position(|e| e.event_id == last),
        ) {
            (Some(first), Some(last)) if first <= last => (first, last),
            _ => return FileVersion::default(),
        },
        None if !edits.is_empty() => (0, edits.len() - 1),
        None => return FileVersion::default(),
    };
    let mut content = initial.filter(|s| valid_text(s));
    let mut before = None;
    for (index, edit) in edits.iter().enumerate().take(last + 1) {
        if index == first {
            before = content.clone();
        }
        let next = edit
            .patch
            .as_deref()
            .and_then(|patch| apply(patch, path, content.as_deref()));
        // Add File proves the resulting contents, not historical absence:
        // some providers allow Add to overwrite an existing file.
        content = next;
    }
    FileVersion {
        before,
        after: content,
    }
}

fn valid_text(text: &str) -> bool {
    text.len() <= MAX_FILE_BYTES && !text.contains('\0')
}

/// Interpret the *original* patch: display conversion may synthesize line 1
/// and flatten unnumbered @@ boundaries, so its diff is not a replay source.
fn apply(patch: &str, path: &str, base: Option<&str>) -> Option<String> {
    if patch.len() > 2 * 1024 * 1024
        || !patch.starts_with("*** Begin Patch\n")
        || !patch.trim_end().ends_with("*** End Patch")
    {
        return None;
    }
    let lines: Vec<_> = patch.lines().collect();
    let headers: Vec<_> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| {
            ["*** Add File: ", "*** Update File: ", "*** Delete File: "]
                .iter()
                .enumerate()
                .find_map(|(kind, prefix)| {
                    line.strip_prefix(prefix)
                        .filter(|p| *p == path)
                        .map(|_| (i, kind))
                })
        })
        .collect();
    // Repeated sections for one file have uncertain intra-call semantics.
    if headers.len() != 1 {
        return None;
    }
    let (start, kind) = headers[0];
    let end = (start + 1..lines.len()).find(|&i| {
        lines[i].starts_with("*** Add File: ")
            || lines[i].starts_with("*** Update File: ")
            || lines[i].starts_with("*** Delete File: ")
            || lines[i] == "*** End Patch"
    })?;
    let body = &lines[start + 1..end];
    let text = match kind {
        0 => {
            let mut text = String::new();
            for line in body {
                text.push_str(line.strip_prefix('+')?);
                text.push('\n');
                if !valid_text(&text) {
                    return None;
                }
            }
            text
        }
        1 => update(base?, body)?,
        2 if body.is_empty() => String::new(),
        _ => return None,
    };
    valid_text(&text).then_some(text)
}

fn update(base: &str, body: &[&str]) -> Option<String> {
    let mut text = base.to_owned();
    let mut cursor = 0;
    let mut start = 0;
    let mut saw_hunk = false;
    // Preserve each @@ boundary. No fuzzy/whitespace matching and no guessed
    // insertion point: exactly one occurrence of the old hunk is required.
    for end in 0..=body.len() {
        if end < body.len() && !body[end].starts_with("@@") {
            continue;
        }
        if end > start {
            let mut old = String::new();
            let mut new = String::new();
            for line in &body[start..end] {
                let rest = line.get(1..)?;
                match line.as_bytes().first()? {
                    b' ' => {
                        old.push_str(rest);
                        old.push('\n');
                        new.push_str(rest);
                        new.push('\n');
                    }
                    b'-' => {
                        old.push_str(rest);
                        old.push('\n');
                    }
                    b'+' => {
                        new.push_str(rest);
                        new.push('\n');
                    }
                    _ => return None, // includes rename, EOF markers, malformed input
                }
            }
            if old.is_empty() {
                return None;
            }
            let mut found = None;
            let mut search = cursor;
            while let Some(offset) = text[search..].find(&old) {
                let at = search + offset;
                if (at == 0 || text.as_bytes()[at - 1] == b'\n')
                    && found.replace(at).is_some()
                {
                    return None;
                }
                // Advance one UTF-8 character, not the whole match, so
                // overlapping repeated hunks are ambiguous too.
                search = at + text[at..].chars().next()?.len_utf8();
            }
            let at = found?;
            if text.len() - old.len() + new.len() > MAX_FILE_BYTES {
                return None;
            }
            text.replace_range(at..at + old.len(), &new);
            cursor = at + new.len();
            saw_hunk = true;
        }
        start = end + 1;
    }
    saw_hunk.then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn edit(id: &str, body: &str) -> RecordedEdit {
        RecordedEdit {
            event_id: id.into(),
            paths: vec!["a".into()],
            patch: Some(format!("*** Begin Patch\n{body}\n*** End Patch")),
        }
    }
    #[test]
    fn anchors_and_replays_only_through_selected_event() {
        let edits = [
            edit("create", "*** Add File: a\n+head\n+one\n+gap\n+two\n+tail"),
            edit(
                "update",
                "*** Update File: a\n@@\n-one\n+ONE\n@@\n-two\n+TWO",
            ),
            edit("later", "*** Update File: a\n@@\n-tail\n+TODAY"),
        ];
        let version = replay(&edits, "a", Some(("update", "update")), None);
        assert_eq!(
            version.before.as_deref(),
            Some("head\none\ngap\ntwo\ntail\n")
        );
        assert_eq!(
            version.after.as_deref(),
            Some("head\nONE\ngap\nTWO\ntail\n")
        );
        assert!(replay(&edits, "other", None, None).after.is_none());
        assert!(replay(&edits, "a", Some(("missing", "update")), None)
            .after
            .is_none());
        assert!(replay(&edits, "a", None, None).before.is_none());
    }
    #[test]
    fn rejects_fragment_anchor_mismatch_ambiguity_and_unknown_edit() {
        let patch = edit("update", "*** Update File: a\n@@\n-one\n+ONE");
        assert!(replay(std::slice::from_ref(&patch), "a", None, None).after.is_none());
        for base in ["wrong\n", "one\none\n", "someone\n"] {
            assert!(replay(std::slice::from_ref(&patch), "a", None, Some(base.into()))
                .after
                .is_none());
        }
        let edits = [
            edit("create", "*** Add File: a\n+one"),
            RecordedEdit {
                event_id: "unknown".into(),
                paths: vec!["a".into()],
                patch: None,
            },
            patch,
        ];
        assert!(replay(&edits, "a", None, None).after.is_none());
        assert!(replay(
            &[edit("overlap", "*** Update File: a\n@@\n-a\n-a\n+b")],
            "a",
            None,
            Some("a\na\na\n".into())
        )
        .after
        .is_none());
    }
    #[test]
    fn preserves_header_like_code_unicode_and_empty_deletion() {
        let edits = [
            edit("create", "*** Add File: a\n+---old\n+你好"),
            edit("update", "*** Update File: a\n@@\n----old\n++++new"),
            edit("delete", "*** Delete File: a"),
        ];
        assert_eq!(
            replay(&edits, "a", Some(("update", "update")), None)
                .after
                .as_deref(),
            Some("+++new\n你好\n")
        );
        assert_eq!(
            replay(&edits, "a", Some(("delete", "delete")), None)
                .after
                .as_deref(),
            Some("")
        );
    }
    #[test]
    fn rejects_oversize_binary_malformed_and_unsupported_rename() {
        for body in [
            format!("*** Add File: a\n+{}", "a".repeat(MAX_FILE_BYTES)),
            "*** Add File: a\n+binary\0".into(),
            "*** Update File: a\n*** Move to: b\n@@\n-one\n+two".into(),
        ] {
            assert!(
                replay(&[edit("edit", &body)], "a", None, Some("one\n".into()))
                    .after
                    .is_none()
            );
        }
        assert!(apply("*** Begin Patch\n*** Add File: a\n+truncated", "a", None).is_none());
    }
}
