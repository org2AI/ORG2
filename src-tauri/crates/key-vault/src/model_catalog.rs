//! Canonical product-supported model catalog and completion helpers.

/// Product-supported Codex OAuth bases.
///
/// Live Codex discovery can be version-gated by the installed CLI. These
/// models remain part of ORGII's Codex OAuth surface even when a live response
/// omits them, so discovery and persisted-account ingestion complete from the
/// same catalog.
pub const CODEX_OAUTH_MODELS: &[&str] = &[
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.2",
    "codex-auto-review",
];

pub const CODEX_OAUTH_DEFAULT_ENABLED_MODELS: &[&str] =
    &["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

/// Complete a Codex OAuth catalog without disturbing provider ordering.
///
/// Every product-supported base and every enabled model must also be present
/// in the available list. The caller owns credential-kind validation.
pub(crate) fn complete_codex_oauth_model_catalog(
    available_models: &mut Vec<String>,
    enabled_models: &[String],
) {
    for model in CODEX_OAUTH_MODELS
        .iter()
        .copied()
        .chain(enabled_models.iter().map(String::as_str))
    {
        if !available_models.iter().any(|available| available == model) {
            available_models.push(model.to_string());
        }
    }
}
