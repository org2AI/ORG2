//! Wire format of the attach stream and the one-line helper replies.
//!
//! ```text
//! ORGII-ATTACH 1\n        sync marker; anything before it is rc-file noise
//! O <len>\n<len bytes>    child stdout
//! E <len>\n<len bytes>    child stderr
//! K\n                     keepalive
//! X <code>\n              child exited and every byte before it was sent
//! ```

use thiserror::Error;
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub const ATTACH_SYNC: &str = "ORGII-ATTACH 1";
pub const REPLY_PREFIX: &str = "ORGII-";

/// Frame headers are tiny; anything longer is a corrupted stream.
const MAX_HEADER_BYTES: usize = 64;
/// A login banner or a chatty rc file is tolerated before the sync marker,
/// but not without bound.
pub const MAX_PREAMBLE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frame {
    Stdout(u64),
    Stderr(u64),
    Keepalive,
    Exit(i32),
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("malformed frame header {0:?}")]
    BadHeader(String),
    #[error("line exceeds {0} bytes")]
    LineTooLong(usize),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub fn parse_frame_header(line: &str) -> Result<Frame, ProtocolError> {
    let bad = || ProtocolError::BadHeader(line.to_string());
    if line == "K" {
        return Ok(Frame::Keepalive);
    }
    let (tag, value) = line.split_once(' ').ok_or_else(bad)?;
    match tag {
        "O" => value.parse().map(Frame::Stdout).map_err(|_| bad()),
        "E" => value.parse().map(Frame::Stderr).map_err(|_| bad()),
        "X" => value.parse().map(Frame::Exit).map_err(|_| bad()),
        _ => Err(bad()),
    }
}

/// Read one `\n`-terminated line without the terminator. `Ok(None)` is a
/// clean EOF before any byte of a new line; EOF mid-line is an error, because
/// for this stream it always means the connection died.
pub async fn read_line_limited<R>(
    reader: &mut R,
    limit: usize,
) -> Result<Option<Vec<u8>>, ProtocolError>
where
    R: AsyncBufRead + Unpin,
{
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(ProtocolError::Io(std::io::ErrorKind::UnexpectedEof.into()))
            };
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            line.extend_from_slice(&available[..newline]);
            reader.consume(newline + 1);
            if line.len() > limit {
                return Err(ProtocolError::LineTooLong(limit));
            }
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return Ok(Some(line));
        }
        let taken = available.len();
        line.extend_from_slice(available);
        reader.consume(taken);
        if line.len() > limit {
            return Err(ProtocolError::LineTooLong(limit));
        }
    }
}

pub async fn read_frame_header<R>(reader: &mut R) -> Result<Option<Frame>, ProtocolError>
where
    R: AsyncBufRead + Unpin,
{
    match read_line_limited(reader, MAX_HEADER_BYTES).await? {
        Some(line) => parse_frame_header(&String::from_utf8_lossy(&line)).map(Some),
        None => Ok(None),
    }
}

/// The helper's verdict for a launch, write or ctl exchange.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    /// `ORGII-OK …` or `ORGII-LAUNCHED …`, with the trailing detail.
    Ok(String),
    /// `ORGII-ERR <reason>`: the host was reached and said no. Not retryable.
    Err(String),
}

/// Find the helper's reply among whatever else landed on stdout. No reply at
/// all means the helper never ran, which is a transport failure.
pub fn find_reply(stdout: &str) -> Option<Reply> {
    stdout.lines().rev().find_map(|line| {
        let rest = line.trim_end().strip_prefix(REPLY_PREFIX)?;
        let (kind, detail) = rest.split_once(' ').unwrap_or((rest, ""));
        match kind {
            "OK" | "LAUNCHED" => Some(Reply::Ok(detail.to_string())),
            "ERR" => Some(Reply::Err(detail.to_string())),
            _ => None,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[test]
    fn parses_every_frame_kind() {
        assert_eq!(parse_frame_header("O 12").unwrap(), Frame::Stdout(12));
        assert_eq!(parse_frame_header("E 0").unwrap(), Frame::Stderr(0));
        assert_eq!(parse_frame_header("K").unwrap(), Frame::Keepalive);
        assert_eq!(parse_frame_header("X 137").unwrap(), Frame::Exit(137));
        for bad in ["", "O", "O x", "O -1", "Z 1", "X", "K 1", "O 1 2"] {
            assert!(parse_frame_header(bad).is_err(), "{bad:?} should fail");
        }
    }

    #[tokio::test]
    async fn reads_lines_and_distinguishes_clean_eof_from_a_cut_line() {
        let mut reader = BufReader::new(&b"first\r\nsecond\n"[..]);
        assert_eq!(
            read_line_limited(&mut reader, 64).await.unwrap(),
            Some(b"first".to_vec())
        );
        assert_eq!(
            read_line_limited(&mut reader, 64).await.unwrap(),
            Some(b"second".to_vec())
        );
        assert_eq!(read_line_limited(&mut reader, 64).await.unwrap(), None);

        let mut cut = BufReader::new(&b"O 12"[..]);
        assert!(read_line_limited(&mut cut, 64).await.is_err());
    }

    #[tokio::test]
    async fn bounds_line_length() {
        let long = [b'a'; 200];
        let mut reader = BufReader::with_capacity(16, &long[..]);
        assert!(matches!(
            read_line_limited(&mut reader, 64).await,
            Err(ProtocolError::LineTooLong(64))
        ));
    }

    #[test]
    fn finds_the_reply_among_shell_noise() {
        assert_eq!(
            find_reply("Welcome to devbox\nORGII-LAUNCHED new\n"),
            Some(Reply::Ok("new".to_string()))
        );
        assert_eq!(find_reply("ORGII-OK\n"), Some(Reply::Ok(String::new())));
        assert_eq!(
            find_reply("motd\nORGII-ERR cwd-missing\n"),
            Some(Reply::Err("cwd-missing".to_string()))
        );
        assert_eq!(find_reply("bash: sh: command not found\n"), None);
        assert_eq!(find_reply(""), None);
    }
}
