use super::*;
use crate::providers::quota_windows::{SESSION_USAGE_TYPE, WEEKLY_USAGE_TYPE};

#[test]
fn parses_oauth_usage_windows() {
    let quota = parse_oauth_usage_response(
        r#"{
            "five_hour": { "utilization": 42.5, "resets_at": "2026-07-07T18:00:00+08:00" },
            "seven_day": { "utilization": 80, "resets_at": "2026-07-13T18:00:00+08:00" }
        }"#,
    )
    .unwrap();

    assert_eq!(quota.plan_type.as_deref(), Some("claude_code"));
    assert_eq!(quota.quota_source.as_deref(), Some("oauth_usage"));
    assert_eq!(quota.reset_time.as_deref(), Some("2026-07-07T10:00:00Z"));
    assert!((quota.remaining_percentage - 20.0).abs() < 0.01);
    assert_eq!(quota.usage_items.len(), 2);
    assert_eq!(quota.usage_items[0].usage_type, SESSION_USAGE_TYPE);
    assert!((quota.usage_items[0].remaining_percentage - 57.5).abs() < 0.01);
    assert_eq!(
        quota.usage_items[0].reset_time.as_deref(),
        Some("2026-07-07T10:00:00Z")
    );
    assert_eq!(quota.usage_items[1].usage_type, WEEKLY_USAGE_TYPE);
    assert!((quota.usage_items[1].remaining_percentage - 20.0).abs() < 0.01);
    assert_eq!(
        quota.usage_items[1].reset_time.as_deref(),
        Some("2026-07-13T10:00:00Z")
    );
}

#[test]
fn ignores_missing_windows() {
    let quota = parse_oauth_usage_response(
        r#"{
            "five_hour": { "resets_at": "2026-07-07T18:00:00+08:00" }
        }"#,
    )
    .unwrap();

    assert_eq!(quota.usage_items.len(), 0);
    assert_eq!(quota.remaining_percentage, 100.0);
}

#[test]
fn applies_profile_rate_limit_tier_to_plan_type() {
    let metadata = parse_oauth_profile_metadata(
        r#"{
            "organization": { "rate_limit_tier": "max_20x" }
        }"#,
    )
    .unwrap();

    assert_eq!(
        metadata.get("rate_limit_tier").map(String::as_str),
        Some("max_20x")
    );
}

#[test]
fn rejects_invalid_json() {
    let err = parse_oauth_usage_response("not-json").unwrap_err();
    assert!(err.contains("parse failed"));
}

fn reset_credits_at(program: serde_json::Value) -> Option<String> {
    let now = DateTime::parse_from_rfc3339("2026-09-24T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    limit_reset_credits(&program, now).map(|credits| credits.summary())
}

#[test]
fn surfaces_banked_limit_resets_from_usage_response() {
    let quota = parse_oauth_usage_response(
        r#"{
            "five_hour": { "utilization": 10, "resets_at": "2026-07-07T18:00:00+08:00" },
            "cedar_ember": {
                "eligible": true,
                "grants": [{
                    "id": "grant-1",
                    "resets_total": 2,
                    "resets_left": 2,
                    "starts_at": "2020-01-01T00:00:00Z",
                    "ends_at": "2099-01-01T00:00:00Z",
                    "clears": ["five_hour", "seven_day"],
                    "paused": false
                }]
            }
        }"#,
    )
    .unwrap();

    assert_eq!(quota.usage_items.len(), 1);
    assert_eq!(
        quota.named_message.as_deref(),
        Some("Reset credits available: 2, next expires 2099-01-01T00:00:00Z")
    );
    assert_eq!(
        quota.reset_credits,
        Some(crate::types::QuotaResetCredits {
            available: 2,
            expirations: vec![crate::types::QuotaResetExpiry {
                count: 2,
                expires_at: "2099-01-01T00:00:00Z".to_string(),
            }],
        })
    );
}

#[test]
fn groups_limit_reset_expiries_earliest_first() {
    let now = DateTime::parse_from_rfc3339("2026-09-24T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let credits = limit_reset_credits(
        &serde_json::json!({
            "eligible": true,
            "grants": [
                { "resets_left": 1, "ends_at": "2026-10-22T21:00:00Z" },
                { "resets_left": 2, "ends_at": "2026-10-04T05:38:00Z" },
                { "resets_left": 1, "ends_at": "2026-10-04T13:38:00+08:00" },
                { "resets_left": 1 }
            ]
        }),
        now,
    )
    .unwrap();

    assert_eq!(credits.available, 5);
    let expirations: Vec<(u64, &str)> = credits
        .expirations
        .iter()
        .map(|expiry| (expiry.count, expiry.expires_at.as_str()))
        .collect();
    assert_eq!(
        expirations,
        vec![(3, "2026-10-04T05:38:00Z"), (1, "2026-10-22T21:00:00Z")]
    );
}

#[test]
fn counts_resets_left_across_live_grants_only() {
    let message = reset_credits_at(serde_json::json!({
        "eligible": true,
        "grants": [
            { "resets_left": 2, "ends_at": "2026-10-01T00:00:00Z" },
            { "resets_left": 1, "ends_at": "2026-09-30T00:00:00+08:00" },
            { "resets_left": 4, "paused": true },
            { "resets_left": 4, "starts_at": "2026-09-25T00:00:00Z" },
            { "resets_left": 4, "ends_at": "2026-09-24T12:00:00Z" },
            { "resets_left": 0, "resets_total": 3 }
        ]
    }));

    assert_eq!(
        message.as_deref(),
        Some("Reset credits available: 3, next expires 2026-09-29T16:00:00Z")
    );
}

#[test]
fn reports_zero_resets_for_eligible_accounts_without_grants() {
    assert_eq!(
        reset_credits_at(serde_json::json!({ "eligible": true, "grants": [] })).as_deref(),
        Some("Reset credits available: 0")
    );
    assert_eq!(
        reset_credits_at(serde_json::json!({ "eligible": true })).as_deref(),
        Some("Reset credits available: 0")
    );
}

#[test]
fn leaves_reset_credits_unknown_when_ineligible_or_absent() {
    assert_eq!(
        reset_credits_at(serde_json::json!({
            "eligible": false,
            "ineligible_reason": "surface"
        })),
        None
    );
    assert_eq!(reset_credits_at(serde_json::json!({})), None);

    let quota = parse_oauth_usage_response(
        r#"{ "five_hour": { "utilization": 10, "resets_at": "2026-07-07T18:00:00+08:00" } }"#,
    )
    .unwrap();
    assert_eq!(quota.named_message, None);
}

#[test]
fn malformed_reset_program_does_not_fail_usage_windows() {
    let quota = parse_oauth_usage_response(
        r#"{
            "five_hour": { "utilization": 10, "resets_at": "2026-07-07T18:00:00+08:00" },
            "cedar_ember": { "grants": "unexpected" }
        }"#,
    )
    .unwrap();

    assert_eq!(quota.usage_items.len(), 1);
    assert_eq!(quota.named_message, None);
}
