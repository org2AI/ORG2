//! Short-lived credential command used by independent clients. Runs before
//! Tauri startup: no windows, proxy listener, session database or background loop.
use market_connect::Connection;
use std::io::Write;

pub fn run(args: impl Iterator<Item = String>) -> Result<(), String> {
    let args: Vec<_> = args.take(5).collect();
    if args.len() != 4 || !matches!(args[3].as_str(), "token" | "headers") {
        return Err("Invalid Market authentication command".into());
    }
    let agent = &args[0];
    let selection = super::source::Selection::parse(&args[1], agent)?;
    let root = std::path::Path::new(&args[2]);
    if !root.is_absolute() || !root.is_dir() {
        return Err("Market application data is unavailable".into());
    }
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "Market authentication runtime unavailable")?;
    let credential = runtime.block_on(async {
        let connection = Connection::restore(args[2].clone(), selection.metadata).await?;
        connection
            .workspace_credential(
                &selection.entitlement_id,
                if agent == "codex" { "codex" } else { "claude" },
            )
            .await
    })?;
    let mut stdout = std::io::stdout().lock();
    if args[3] == "headers" {
        serde_json::to_writer(
            &mut stdout,
            &serde_json::json!({"Authorization":format!("Bearer {}",credential.bearer())}),
        )
        .map_err(|_| "Could not deliver Market credentials")?;
    } else {
        stdout
            .write_all(credential.bearer().as_bytes())
            .map_err(|_| "Could not deliver Market credentials")?;
    }
    stdout
        .write_all(b"\n")
        .map_err(|_| "Could not deliver Market credentials")?;
    Ok(())
}
