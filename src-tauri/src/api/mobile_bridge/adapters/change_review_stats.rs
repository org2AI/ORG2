//! Count only unified-diff body lines. A code line beginning with `++` or
//! `--` must not be mistaken for a file header; binary counts stay unknown.
pub(super) fn numstat(patch: &str) -> Option<(i32, i32)> {
    if patch.is_empty() {
        return Some((0, 0));
    }
    let mut in_hunk = false;
    let mut saw_hunk = false;
    let mut added = 0;
    let mut removed = 0;
    for line in patch.lines() {
        if line.starts_with("Binary files ") || line == "GIT binary patch" {
            return None;
        }
        if line.starts_with("diff --git ") {
            in_hunk = false;
        } else if line.starts_with("@@ ") && line.contains(" @@") {
            in_hunk = true;
            saw_hunk = true;
        } else if in_hunk {
            match line.as_bytes().first() {
                Some(b'+') => added += 1,
                Some(b'-') => removed += 1,
                Some(b' ' | b'\\') => {}
                _ => return None,
            }
        }
    }
    saw_hunk.then_some((added, removed))
}

#[cfg(test)]
mod tests {
    use super::numstat;

    #[test]
    fn headers_are_not_code_and_binary_is_not_zero() {
        assert_eq!(
            numstat("--- a\n+++ b\n@@ -1 +1 @@\n---old\n+++new\n"),
            Some((1, 1))
        );
        assert_eq!(numstat("Binary files a and b differ\n"), None);
        assert_eq!(numstat("rename from a\nrename to b\n"), None);
        assert_eq!(numstat(""), Some((0, 0)));
    }
}
