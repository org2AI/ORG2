//! Stateful UTF-8 decoding and two deliberately separate projections: local
//! terminal replay and safe agent inspection. Never publish an unfinished
//! sensitive line to inspection merely because a PTY read ended.
use crate::redaction::redact_terminal_text;

/// Both projections have an independent hard UTF-8 byte budget.
const MAX_SNAPSHOT_BYTES: usize = 320_000;
const MAX_PENDING_LINE_BYTES: usize = 16 * 1024;

#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}
impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8], eof: bool) -> String {
        self.pending.extend_from_slice(bytes);
        let mut result = String::new();
        let mut consumed = 0;
        while consumed < self.pending.len() {
            match std::str::from_utf8(&self.pending[consumed..]) {
                Ok(text) => {
                    result.push_str(text);
                    consumed = self.pending.len();
                }
                Err(error) => {
                    let valid_end = consumed + error.valid_up_to();
                    result.push_str(
                        std::str::from_utf8(&self.pending[consumed..valid_end])
                            .expect("validated UTF-8 prefix"),
                    );
                    consumed = valid_end;
                    match error.error_len() {
                        Some(length) => {
                            result.push('\u{fffd}');
                            consumed += length;
                        }
                        None if eof => {
                            result.push('\u{fffd}');
                            consumed = self.pending.len();
                        }
                        None => break,
                    }
                }
            }
        }
        self.pending.drain(..consumed);
        result
    }
    pub fn pending(&self) -> &[u8] {
        &self.pending
    }
}

#[derive(Default)]
pub struct StreamSnapshot {
    decoder: Utf8Stream,
    replay: String,
    inspected: String,
    line: String,
    discard_line: bool,
    private_key: bool,
    marker_tail: String,
    line_key_begin: bool,
    line_key_end: bool,
    covers_seq: u64,
}

fn append_bounded(buffer: &mut String, text: &str) {
    buffer.push_str(text);
    if buffer.len() <= MAX_SNAPSHOT_BYTES {
        return;
    }
    let mut start = buffer.len() - MAX_SNAPSHOT_BYTES * 4 / 5;
    while !buffer.is_char_boundary(start) {
        start += 1;
    }
    buffer.drain(..start);
}

impl StreamSnapshot {
    pub fn push(&mut self, bytes: &[u8]) {
        self.covers_seq += bytes.len() as u64;
        let text = self.decoder.push(bytes, false);
        self.push_text(&text);
    }
    pub fn finish(&mut self) {
        let text = self.decoder.push(&[], true);
        self.push_text(&text);
        self.finish_line();
    }
    fn push_text(&mut self, text: &str) {
        append_bounded(&mut self.replay, text);
        for ch in text.chars() {
            self.marker_tail.push(ch);
            if self.marker_tail.len() > 128 {
                let mut remove = self.marker_tail.len() - 96;
                while !self.marker_tail.is_char_boundary(remove) {
                    remove += 1;
                }
                self.marker_tail.drain(..remove);
            }
            if self.marker_tail.ends_with("PRIVATE KEY-----") {
                self.line_key_begin |= self.marker_tail.contains("-----BEGIN ");
                self.line_key_end |= self.marker_tail.contains("-----END ");
            }
            if !self.discard_line {
                self.line.push(ch);
                if self.line.len() > MAX_PENDING_LINE_BYTES {
                    self.line.clear();
                    self.discard_line = true;
                }
            }
            if ch == '\n' {
                self.finish_line();
            }
        }
    }
    fn finish_line(&mut self) {
        if self.discard_line {
            append_bounded(&mut self.inspected, "[redacted oversized terminal line]\n");
            self.discard_line = false;
            // Discard only this line unless an actual private-key marker
            // was observed, including markers after the retention budget.
            if self.line_key_begin {
                self.private_key = true;
            }
            if self.line_key_end {
                self.private_key = false;
            }
        } else if self.private_key {
            if self.line_key_end {
                self.private_key = false;
            }
        } else if self.line_key_begin
            || (self.line.contains("-----BEGIN ") && self.line.contains("PRIVATE KEY"))
        {
            append_bounded(&mut self.inspected, "secret_*******\n");
            self.private_key = !self.line_key_end;
        } else {
            append_bounded(&mut self.inspected, &redact_terminal_text(&self.line));
        }
        self.line.clear();
        self.marker_tail.clear();
        self.line_key_begin = false;
        self.line_key_end = false;
    }
    pub fn inspection(&self) -> &str {
        &self.inspected
    }
    pub fn has_withheld_output(&self) -> bool {
        !self.line.is_empty()
            || self.discard_line
            || self.private_key
            || !self.decoder.pending().is_empty()
    }
    pub fn replay(&self) -> &str {
        &self.replay
    }
    pub fn covers_seq(&self) -> u64 {
        self.covers_seq
    }
    pub fn pending_utf8(&self) -> &[u8] {
        self.decoder.pending()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_utf8_split_has_identical_replay_and_byte_offset() {
        let text = "中─😀文\n";
        for split in 0..=text.len() {
            let mut s = StreamSnapshot::default();
            s.push(&text.as_bytes()[..split]);
            let prefix = s.replay().as_bytes().to_vec();
            assert_eq!(
                [prefix.as_slice(), s.pending_utf8()].concat(),
                &text.as_bytes()[..split]
            );
            assert_eq!(s.covers_seq(), split as u64);
            s.push(&text.as_bytes()[split..]);
            assert_eq!(s.replay(), text);
            assert_eq!(s.inspection(), text);
            assert!(s.pending_utf8().is_empty());
        }
    }
    #[test]
    fn every_secret_split_is_withheld_until_safe_and_redacted_at_eof() {
        for text in [
            "OPENAI_API_KEY=not-a-real-secret-value",
            "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
            "ghp_abcdefghijklmnopqrstuvwxyz",
            "sk-abcdefghijklmnopqrstuvwxyz",
            "AKIA1234567890123456",
            "aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccc",
            "-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----",
        ] {
            for split in 0..=text.len() {
                let mut s = StreamSnapshot::default();
                s.push(&text.as_bytes()[..split]);
                assert!(!s.inspection().contains("not-a-real"));
                assert!(!s.inspection().contains("private-key-body"));
                s.push(&text.as_bytes()[split..]);
                s.finish();
                assert!(!s.inspection().contains("not-a-real"));
                assert!(!s.inspection().contains("abcdefghijklmnopqrstuvwxyz"));
                assert!(!s.inspection().contains("private-key-body"));
                assert!(
                    s.inspection().contains("secret_*******"),
                    "{text} at {split}"
                );
                assert_eq!(s.replay(), text);
            }
        }
    }
    #[test]
    fn private_key_is_hidden_while_open_and_following_lines_recover() {
        let mut s = StreamSnapshot::default();
        for byte in b"-----BEGIN RSA PRIVATE KEY-----\nprivate body\n-----END RSA PRIVATE KEY-----\nnormal\n" { s.push(&[*byte]); }
        assert_eq!(s.inspection(), "secret_*******\nnormal\n");
    }
    #[test]
    fn eof_replaces_incomplete_utf8_once_and_is_idempotent() {
        let mut s = StreamSnapshot::default();
        s.push(&[0xe2, 0x94]);
        assert_eq!(s.replay(), "");
        s.finish();
        s.finish();
        assert_eq!(s.replay(), "\u{fffd}");
        assert_eq!(s.inspection(), "\u{fffd}");
        assert_eq!(s.covers_seq(), 2);
    }
    #[test]
    fn unclosed_or_oversized_sensitive_lines_never_publish_tail() {
        let mut s = StreamSnapshot::default();
        s.push(b"TOKEN=");
        s.push(&vec![b'x'; MAX_PENDING_LINE_BYTES * 3]);
        assert!(s.inspection().is_empty());
        assert!(s.line.len() <= MAX_PENDING_LINE_BYTES);
        s.finish();
        assert!(!s.inspection().contains("xxx"));
    }
    #[test]
    fn oversized_normal_line_does_not_hide_following_valid_output() {
        let mut s = StreamSnapshot::default();
        s.push(&vec![b'x'; MAX_PENDING_LINE_BYTES * 2]);
        s.push(b"\nnormal output\n");
        assert_eq!(
            s.inspection(),
            "[redacted oversized terminal line]\nnormal output\n"
        );
    }
    #[test]
    fn private_key_marker_after_oversized_prefix_still_hides_body() {
        let mut s = StreamSnapshot::default();
        s.push(&vec![b'x'; MAX_PENDING_LINE_BYTES * 2]);
        for byte in b"-----BEGIN RSA PRIVATE KEY-----\nprivate body\n-----END RSA PRIVATE KEY-----\nnormal\n" { s.push(&[*byte]); }
        assert!(!s.inspection().contains("private body"));
        assert!(s.inspection().ends_with("normal\n"));
    }
    #[test]
    fn replay_and_inspection_have_hard_byte_bounds() {
        let mut s = StreamSnapshot::default();
        for _ in 0..100_000 {
            s.push("中abc\n".as_bytes());
        }
        assert!(s.replay().len() <= MAX_SNAPSHOT_BYTES);
        assert!(s.inspection().len() <= MAX_SNAPSHOT_BYTES);
        assert!(s.replay().is_char_boundary(0));
    }
}
