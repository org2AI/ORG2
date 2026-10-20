//! Canonical product-supported model catalog and completion helpers.

/// Current direct MiniMax text models, in default-selection order.
pub const MINIMAX_TEXT_MODELS: &[&str] = &["MiniMax-M3.1-Flash", "MiniMax-M3"];

/// Project discovery into the current text catalog without rewriting saved IDs.
/// Gateways retain their own spelling and only advertise models they discovered.
/// Enabled models and explicit aliases remain available, including legacy IDs.
pub(crate) fn current_minimax_catalog(
    provider: &str,
    available: &[String],
    explicit: &[String],
) -> Vec<String> {
    let direct = provider == "minimax_api";
    let gateway = matches!(provider, "openrouter_api" | "opencode" | "opencode_cli");
    if !direct && !gateway {
        return available.to_vec();
    }
    let mut models: Vec<String> = if direct {
        MINIMAX_TEXT_MODELS
            .iter()
            .map(|id| id.to_string())
            .collect()
    } else {
        Vec::new()
    };
    for id in available.iter().chain(explicit) {
        let lower = id.to_ascii_lowercase();
        let bare = lower.strip_prefix("minimax/").unwrap_or(&lower);
        let current_text = bare == "minimax-m3"
            || match provider {
                "minimax_api" => bare == "minimax-m3.1-flash",
                "openrouter_api" => bare == "minimax-m3.1-flash:free",
                _ => bare == "minimax-m3.1-flash-free",
            };
        let legacy_text =
            (bare.starts_with("minimax-m") || bare.starts_with("abab")) && !current_text;
        if (!legacy_text || explicit.contains(id)) && !models.contains(id) {
            models.push(id.clone());
        }
    }
    if gateway {
        let flash = models.iter().position(|id| {
            matches!(
                id.to_ascii_lowercase().as_str(),
                "minimax/minimax-m3.1-flash:free" | "minimax-m3.1-flash-free"
            )
        });
        let m3 = models.iter().position(|id| {
            matches!(
                id.to_ascii_lowercase().as_str(),
                "minimax/minimax-m3" | "minimax-m3"
            )
        });
        if let (Some(flash), Some(m3)) = (flash, m3) {
            if flash > m3 {
                let model = models.remove(flash);
                models.insert(m3, model);
            }
        }
    }
    models
}

#[cfg(test)]
mod minimax_tests {
    use super::*;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn minimax_catalog_keeps_saved_and_custom_models() {
        assert_eq!(
            current_minimax_catalog(
                "minimax_api",
                &ids(&["MiniMax-M2.7", "MiniMax-M3", "speech-02-hd"]),
                &ids(&["MiniMax-M2.5", "private-model"]),
            ),
            ids(&[
                "MiniMax-M3.1-Flash",
                "MiniMax-M3",
                "speech-02-hd",
                "MiniMax-M2.5",
                "private-model"
            ])
        );
    }

    #[test]
    fn minimax_gateway_flash_is_first_without_changing_nontext_or_saved_ids() {
        for (provider, flash, m3, old) in [
            (
                "openrouter_api",
                "minimax/minimax-m3.1-flash:free",
                "minimax/minimax-m3",
                "minimax/minimax-m2.7",
            ),
            (
                "opencode",
                "minimax-m3.1-flash-free",
                "minimax-m3",
                "minimax-m2.7",
            ),
        ] {
            let discovered = ids(&["other/model", m3, old, flash, "speech-02-hd"]);
            let explicit = ids(&[old, "private-deployment"]);
            assert_eq!(
                current_minimax_catalog(provider, &discovered, &explicit),
                ids(&[
                    "other/model",
                    flash,
                    m3,
                    old,
                    "speech-02-hd",
                    "private-deployment"
                ])
            );
            assert_eq!(explicit, ids(&[old, "private-deployment"]));
            assert_eq!(
                discovered,
                ids(&["other/model", m3, old, flash, "speech-02-hd"])
            );
        }
    }

    #[test]
    fn minimax_gateway_keeps_wire_ids_and_does_not_invent_models() {
        let discovered = ids(&["other/model", "minimax/minimax-m2.7", "minimax/minimax-m3"]);
        assert_eq!(
            current_minimax_catalog("openrouter_api", &discovered, &[]),
            ids(&["other/model", "minimax/minimax-m3"])
        );
        assert_eq!(
            current_minimax_catalog("custom", &discovered, &[]),
            discovered
        );
    }
}

/// Product-supported Codex OAuth bases.
///
/// Live Codex discovery can be version-gated by the installed CLI. These
/// models remain part of ORGII's Codex OAuth surface even when a live response
/// omits them, so discovery and persisted-account ingestion complete from the
/// same catalog.
pub const CODEX_OAUTH_MODELS: &[&str] = &[
    "gpt-6-astra",
    "gpt-6.1-sol",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-reserve",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.2",
    "codex-auto-review",
];

pub const CODEX_OAUTH_DEFAULT_ENABLED_MODELS: &[&str] = &[
    "gpt-6-astra",
    "gpt-6.1-sol",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-reserve",
];

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
