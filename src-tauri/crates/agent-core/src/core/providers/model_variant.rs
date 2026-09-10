//! Provider-neutral parsing for model ids with ORG2 variant suffixes.
//!
//! The parsed base id is used both for wire-model selection and for inheriting
//! model capabilities such as a provider-reported context window. The
//! corresponding frontend grammar lives in `src/util/modelNameGrammar.ts`.
//! `baseline` remains accepted here for backend compatibility; the frontend
//! represents baseline as the bare model id rather than a suffix.

/// A model id split into the provider's base id and ORG2's suffix tokens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedModelVariantId {
    pub base_model: String,
    pub suffix_tokens: Vec<String>,
}

/// Tokens that ORG2 may append to a provider model id. Provider-native
/// suffixes (`mini`, `flash`, date stamps, `20250514`) are deliberately absent
/// so they are never stripped.
const SUFFIX_TOKENS: &[&str] = &[
    "none",
    "baseline",
    "low",
    "medium",
    "high",
    "extra",
    "extra-high",
    "xhigh",
    "max",
    "ultra",
    "ultracode",
    "minimal",
    "thinking",
    "fast",
];

fn is_suffix_token(token: &str) -> bool {
    SUFFIX_TOKENS.contains(&token)
}

/// Peel only trailing ORG2 variant tokens from `model`.
///
/// `extra-high` is encoded as two hyphen-delimited segments, so it is merged
/// back into one token for downstream reasoning-level parsing.
pub fn parse_model_variant_id(model: &str) -> ParsedModelVariantId {
    let lower = model.to_lowercase();
    let lower_segments: Vec<&str> = lower.split('-').collect();

    let mut split = lower_segments.len();
    while split > 1 {
        if !is_suffix_token(lower_segments[split - 1]) {
            break;
        }
        split -= 1;
    }

    if split == lower_segments.len() {
        return ParsedModelVariantId {
            base_model: model.to_string(),
            suffix_tokens: Vec::new(),
        };
    }

    let raw_tokens = &lower_segments[split..];
    let mut suffix_tokens = Vec::with_capacity(raw_tokens.len());
    let mut cursor = 0;
    while cursor < raw_tokens.len() {
        if raw_tokens[cursor] == "extra"
            && cursor + 1 < raw_tokens.len()
            && raw_tokens[cursor + 1] == "high"
        {
            suffix_tokens.push("extra-high".to_string());
            cursor += 2;
        } else {
            suffix_tokens.push(raw_tokens[cursor].to_string());
            cursor += 1;
        }
    }

    ParsedModelVariantId {
        // Preserve the provider model id's original casing.
        base_model: model.split('-').take(split).collect::<Vec<_>>().join("-"),
        suffix_tokens,
    }
}
