//! Display-only host metadata returned after the bridge authenticates a phone.
//! Never collect hardware UUIDs, serial numbers, home paths, or Cloud accounts.

use serde::Serialize;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopIdentity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

fn label(value: Option<String>) -> Option<String> {
    let value = value?;
    let value = value.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return None;
    }
    Some(value.chars().take(128).collect())
}

/// One native query per successful initialize, off the async executor. This
/// refreshes renamed hosts on reconnect without a process scan, subprocess,
/// timer, or app-lifetime cache. Unavailable metadata is not invented.
pub(super) fn collect() -> DesktopIdentity {
    DesktopIdentity {
        name: label(sysinfo::System::host_name()),
        // Native manufacturer model identifier; do not guess a marketing name.
        model: label(sysinfo::Product::name()),
        username: label(std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" }).ok()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_only_bounded_display_metadata() {
        let identity = DesktopIdentity {
            name: label(Some(" Work Mac ".into())),
            model: label(Some("Mac14,7".into())),
            username: label(Some("alex".into())),
        };
        assert_eq!(
            serde_json::to_value(identity).unwrap(),
            serde_json::json!({ "name": "Work Mac", "model": "Mac14,7", "username": "alex" })
        );
        assert_eq!(
            serde_json::to_value(DesktopIdentity::default()).unwrap(),
            serde_json::json!({})
        );
    }

    #[test]
    fn unavailable_and_invalid_metadata_is_omitted_not_replaced_by_an_id() {
        assert!(label(None).is_none());
        assert!(label(Some("  ".into())).is_none());
        assert!(label(Some("bad\nlabel".into())).is_none());
        assert_eq!(label(Some("机".repeat(200))).unwrap().chars().count(), 128);
    }
}
