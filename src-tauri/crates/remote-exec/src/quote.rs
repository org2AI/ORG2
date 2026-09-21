//! Shell quoting and identifier validation.
//!
//! Everything that reaches the remote shell is either validated against a
//! narrow alphabet (run ids, env names, host aliases) or single-quoted here.
//! Prompts travel inside argv, so treat every value as hostile.

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum QuoteError {
    #[error("value contains a NUL byte")]
    Nul,
    #[error("invalid run id {0:?}: use 1-64 of [A-Za-z0-9_-]")]
    RunId(String),
    #[error("invalid environment variable name {0:?}")]
    EnvName(String),
    #[error("invalid ssh host alias {0:?}")]
    HostAlias(String),
    #[error("invalid ssh option {0:?}: expected Key=Value")]
    SshOption(String),
}

/// Single-quote `value` for POSIX sh. Inside single quotes nothing is
/// special, so the only character to handle is the quote itself.
pub fn sh_quote(value: &str) -> Result<String, QuoteError> {
    if value.contains('\0') {
        return Err(QuoteError::Nul);
    }
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            quoted.push_str("'\\''");
        } else {
            quoted.push(ch);
        }
    }
    quoted.push('\'');
    Ok(quoted)
}

/// Run ids become a directory name and an unquoted word in remote commands.
pub fn validate_run_id(run_id: &str) -> Result<(), QuoteError> {
    let ok = !run_id.is_empty()
        && run_id.len() <= 64
        && run_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(QuoteError::RunId(run_id.to_string()))
    }
}

pub fn validate_env_name(name: &str) -> Result<(), QuoteError> {
    let mut bytes = name.bytes();
    let first_ok = bytes
        .next()
        .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_');
    if first_ok && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        Ok(())
    } else {
        Err(QuoteError::EnvName(name.to_string()))
    }
}

/// A host alias is passed to `ssh` as an operand. A leading `-` would be
/// parsed as an option (`-oProxyCommand=…` runs a local command), so reject it
/// even though the connector also passes `--`.
pub fn validate_host_alias(alias: &str) -> Result<(), QuoteError> {
    let ok = !alias.is_empty()
        && alias.len() <= 255
        && !alias.starts_with('-')
        && alias.bytes().all(|b| {
            b.is_ascii_alphanumeric()
                || matches!(b, b'.' | b'_' | b'-' | b'@' | b':' | b'[' | b']' | b'%')
        });
    if ok {
        Ok(())
    } else {
        Err(QuoteError::HostAlias(alias.to_string()))
    }
}

/// `Key=Value` for `ssh -o`. The key must be a plain option name so a value
/// can never be smuggled in as a second flag.
pub fn validate_ssh_option(option: &str) -> Result<(), QuoteError> {
    let ok = option.split_once('=').is_some_and(|(key, value)| {
        !key.is_empty()
            && key.bytes().all(|b| b.is_ascii_alphanumeric())
            && !value.is_empty()
            && !value.contains(['\0', '\n', '\r'])
    });
    if ok {
        Ok(())
    } else {
        Err(QuoteError::SshOption(option.to_string()))
    }
}

/// Pick a here-document delimiter that no line of `bodies` equals. A quoted
/// value may span lines, so a fixed delimiter could be closed early by text
/// the user typed into a prompt.
pub fn pick_heredoc_delimiter(prefix: &str, bodies: &[&str]) -> String {
    let mut attempt = 0u64;
    loop {
        let candidate = format!("{prefix}_{attempt}");
        let collides = bodies
            .iter()
            .any(|body| body.lines().any(|line| line == candidate));
        if !collides {
            return candidate;
        }
        attempt += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_plain_and_hostile_values() {
        assert_eq!(sh_quote("abc").unwrap(), "'abc'");
        assert_eq!(sh_quote("").unwrap(), "''");
        assert_eq!(sh_quote("it's").unwrap(), "'it'\\''s'");
        assert_eq!(sh_quote("$(rm -rf ~)`x`").unwrap(), "'$(rm -rf ~)`x`'");
        assert_eq!(sh_quote("a\0b"), Err(QuoteError::Nul));
    }

    #[cfg(unix)]
    #[test]
    fn quoted_values_round_trip_through_a_real_shell() {
        let samples = [
            "plain",
            "",
            "it's \"quoted\"",
            "$(echo pwned) `echo pwned` $HOME ${X}",
            "line one\nline two\n",
            "back\\slash \\n literal",
            "'; echo pwned; '",
            "tab\there * ? [a-z] ~ ! # & | ; < > ( ) { }",
            "unicode \u{1F600} \u{4E2D}\u{6587}",
        ];
        for sample in samples {
            let script = format!("printf '%s' {}", sh_quote(sample).unwrap());
            let output = std::process::Command::new("sh")
                .arg("-c")
                .arg(&script)
                .output()
                .expect("sh runs");
            assert!(output.status.success(), "sh failed for {sample:?}");
            assert_eq!(String::from_utf8_lossy(&output.stdout), sample);
        }
    }

    #[test]
    fn validates_identifiers() {
        assert!(validate_run_id("sess_01-a").is_ok());
        assert!(validate_run_id("").is_err());
        assert!(validate_run_id("../etc").is_err());
        assert!(validate_run_id("a b").is_err());
        assert!(validate_run_id(&"x".repeat(65)).is_err());

        assert!(validate_env_name("ANTHROPIC_API_KEY").is_ok());
        assert!(validate_env_name("_x1").is_ok());
        assert!(validate_env_name("1X").is_err());
        assert!(validate_env_name("A=B").is_err());
        assert!(validate_env_name("").is_err());

        assert!(validate_host_alias("devbox").is_ok());
        assert!(validate_host_alias("me@gpu-1.example.com").is_ok());
        assert!(validate_host_alias("[fe80::1%en0]").is_ok());
        assert!(validate_host_alias("-oProxyCommand=evil").is_err());
        assert!(validate_host_alias("host name").is_err());
        assert!(validate_host_alias("host;rm").is_err());
        assert!(validate_host_alias("").is_err());

        assert!(validate_ssh_option("Port=2222").is_ok());
        assert!(validate_ssh_option("Port").is_err());
        assert!(validate_ssh_option("-o=x").is_err());
        assert!(validate_ssh_option("Port=22\nProxyCommand=x").is_err());
    }

    #[test]
    fn heredoc_delimiter_avoids_every_body_line() {
        assert_eq!(pick_heredoc_delimiter("EOF", &["a\nb"]), "EOF_0");
        assert_eq!(pick_heredoc_delimiter("EOF", &["a\nEOF_0\nb"]), "EOF_1");
        assert_eq!(
            pick_heredoc_delimiter("EOF", &["EOF_0", "x\nEOF_1"]),
            "EOF_2"
        );
        // Only a whole-line match closes a here-document.
        assert_eq!(pick_heredoc_delimiter("EOF", &["xEOF_0 "]), "EOF_0");
    }
}
