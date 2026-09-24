//! Codex quota mapping for the ChatGPT usage API and the app-server rate-limit RPC.

use crate::providers::quota_windows::{
    group_reset_expiries, normalize_reset_time, quota_from_windows, unix_seconds_to_rfc3339,
    QuotaWindow,
};
use crate::types::{ModelQuotaInfo, QuotaInfo, QuotaResetCredits, QuotaResetExpiry};
use chrono::{DateTime, Utc};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexRateLimitWindow {
    used_percent: Option<f64>,
    window_duration_mins: Option<i64>,
    resets_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct CodexRateLimitsPayload {
    #[serde(rename = "planType")]
    plan_type: Option<String>,
    primary: Option<CodexRateLimitWindow>,
    secondary: Option<CodexRateLimitWindow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexRateLimitResetCredits {
    available_count: Option<u64>,
    total_earned_count: Option<u64>,
    next_expires_at: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodexRateLimitsResponse {
    rate_limits: Option<CodexRateLimitsPayload>,
    rate_limits_by_limit_id: Option<std::collections::BTreeMap<String, serde_json::Value>>,
    rate_limit_reset_credits: Option<CodexRateLimitResetCredits>,
}

fn parse_usage_window_reset(window: &serde_json::Value) -> Option<String> {
    window
        .get("reset_at")
        .or_else(|| window.get("resets_at"))
        .or_else(|| window.get("resetAt"))
        .or_else(|| window.get("resetsAt"))
        .and_then(|value| {
            if let Some(ts) = value.as_i64() {
                unix_seconds_to_rfc3339(ts)
            } else {
                value.as_str().map(str::to_string).and_then(|text| {
                    crate::providers::quota_windows::normalize_reset_time(&text).or(Some(text))
                })
            }
        })
}

fn parse_usage_window_percent(window: &serde_json::Value) -> Option<f64> {
    window
        .get("used_percent")
        .or_else(|| window.get("usedPercent"))
        .or_else(|| window.get("percent_used"))
        .or_else(|| window.get("percentUsed"))
        .or_else(|| window.get("usage_percent"))
        .or_else(|| window.get("usagePercent"))
        .or_else(|| window.get("utilization"))
        .and_then(|value| value.as_f64())
}

fn parse_usage_window_duration_minutes(window: &serde_json::Value) -> Option<i64> {
    window
        .get("window_duration_mins")
        .or_else(|| window.get("windowDurationMins"))
        .or_else(|| window.get("window_minutes"))
        .or_else(|| window.get("windowMinutes"))
        .and_then(|value| value.as_i64())
        .filter(|minutes| *minutes > 0)
        .or_else(|| {
            window
                .get("limit_window_seconds")
                .or_else(|| window.get("limitWindowSeconds"))
                .and_then(|value| value.as_i64())
                .filter(|seconds| *seconds > 0)
                .map(|seconds| seconds.saturating_add(59) / 60)
        })
}

fn codex_quota_window(
    used_percent: f64,
    reset_time: Option<String>,
    window_duration_mins: Option<i64>,
    fallback: fn(f64, Option<String>) -> QuotaWindow,
) -> QuotaWindow {
    match window_duration_mins {
        // Codex currently reports a 300-minute session window and a
        // 10,080-minute weekly window. Classify by the supplied duration so a
        // temporarily absent 5-hour limit cannot relabel the weekly window.
        Some(minutes) if minutes >= 24 * 60 => QuotaWindow::weekly(used_percent, reset_time),
        Some(_) => QuotaWindow::session(used_percent, reset_time),
        None => fallback(used_percent, reset_time),
    }
}

fn push_usage_window(
    windows: &mut Vec<QuotaWindow>,
    fallback_usage_type: fn(f64, Option<String>) -> QuotaWindow,
    window: Option<&serde_json::Value>,
) {
    if let Some(window) = window {
        if let Some(used_percent) = parse_usage_window_percent(window) {
            windows.push(codex_quota_window(
                used_percent,
                parse_usage_window_reset(window),
                parse_usage_window_duration_minutes(window),
                fallback_usage_type,
            ));
        }
    }
}

fn model_quota(model: &str, limit_id: &str, limit: &serde_json::Value) -> Option<ModelQuotaInfo> {
    let mut windows = Vec::new();
    let primary = limit
        .get("primary_window")
        .or_else(|| limit.get("primary"))
        .filter(|window| !window.is_null());
    let secondary = limit
        .get("secondary_window")
        .or_else(|| limit.get("secondary"))
        .filter(|window| !window.is_null());
    for window in [primary, secondary].into_iter().flatten() {
        // Unknown or malformed windows must not turn into available capacity.
        let percent = parse_usage_window_percent(window)?;
        if !percent.is_finite() || !(0.0..=100.0).contains(&percent) {
            return None;
        }
    }
    push_usage_window(
        &mut windows,
        if secondary.is_some() {
            QuotaWindow::session
        } else {
            QuotaWindow::weekly
        },
        primary,
    );
    push_usage_window(&mut windows, QuotaWindow::weekly, secondary);
    if windows.is_empty() {
        return None;
    }
    Some(ModelQuotaInfo {
        model: model.to_owned(),
        limit_id: limit_id.to_owned(),
        allowed: limit.get("allowed").and_then(serde_json::Value::as_bool),
        limit_reached: limit
            .get("limit_reached")
            .or_else(|| limit.get("limitReached"))
            .and_then(serde_json::Value::as_bool),
        usage_items: quota_from_windows("codex", "codex_model_pool", windows).usage_items,
    })
}

pub(super) fn model_quotas_from_usage_json(data: &serde_json::Value) -> Vec<ModelQuotaInfo> {
    data.get("additional_rate_limits")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            model_quota(
                entry.get("normal_model_slug")?.as_str()?,
                entry.get("limit_name")?.as_str()?,
                entry.get("rate_limit")?,
            )
        })
        .collect()
}

pub(super) fn quota_from_usage_json(data: &serde_json::Value) -> Option<QuotaInfo> {
    let rate_limit = data
        .get("rate_limit")
        .or_else(|| data.get("rate_limits"))
        .unwrap_or(data);
    let mut windows = Vec::new();

    let primary_window = rate_limit
        .get("primary_window")
        .or_else(|| rate_limit.get("primary"));
    let five_hour_window = rate_limit
        .get("five_hour")
        .or_else(|| data.get("five_hour"));
    let weekly_window = rate_limit
        .get("secondary_window")
        .or_else(|| rate_limit.get("secondary"))
        .or_else(|| rate_limit.get("seven_day"))
        .or_else(|| data.get("seven_day"));

    if primary_window.is_some() {
        // Older payloads did not include the window duration. When OpenAI
        // returns only a generic primary window, it is the surviving weekly
        // limit; when a secondary window is also present, primary is the 5h
        // limit. Explicit duration metadata always wins in codex_quota_window.
        let fallback: fn(f64, Option<String>) -> QuotaWindow = if weekly_window.is_some() {
            QuotaWindow::session
        } else {
            QuotaWindow::weekly
        };
        push_usage_window(&mut windows, fallback, primary_window);
    } else {
        push_usage_window(&mut windows, QuotaWindow::session, five_hour_window);
    }
    push_usage_window(&mut windows, QuotaWindow::weekly, weekly_window);

    let model_quotas = model_quotas_from_usage_json(data);
    if windows.is_empty() && model_quotas.is_empty() {
        return None;
    }

    let plan_type = data
        .get("plan_type")
        .and_then(|v| v.as_str())
        .unwrap_or("plus")
        .to_lowercase();

    let mut quota = if windows.is_empty() {
        QuotaInfo {
            plan_type: Some(plan_type),
            quota_source: Some("codex_usage_api".into()),
            ..QuotaInfo::new()
        }
    } else {
        quota_from_windows(&plan_type, "codex_usage_api", windows)
    };
    // The usage API reports available credits inline, without expiries;
    // absence is unknown, not zero.
    if let Some(available) = data
        .get("rate_limit_reset_credits")
        .and_then(|credits| credits.get("available_count"))
        .and_then(serde_json::Value::as_u64)
    {
        quota.set_reset_credits(QuotaResetCredits {
            available,
            expirations: Vec::new(),
        });
    }
    quota.model_quotas = model_quotas;
    Some(quota)
}

/// Maps `GET /wham/rate-limit-reset-credits`, which lists each credit with its
/// own expiry. Only unexpired credits with `status: "available"` count.
pub(super) fn reset_credits_from_list_json(
    data: &serde_json::Value,
    now: DateTime<Utc>,
) -> Option<QuotaResetCredits> {
    let credits = data.get("credits")?.as_array()?;
    let mut live = 0u64;
    let mut expiries = Vec::new();
    for credit in credits {
        if credit.get("status").and_then(serde_json::Value::as_str) != Some("available")
            || credit
                .get("is_supported_by_plan")
                .and_then(serde_json::Value::as_bool)
                == Some(false)
        {
            continue;
        }
        let expires_at = credit
            .get("expires_at")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc));
        if expires_at.is_some_and(|expires| expires <= now) {
            continue;
        }
        live += 1;
        if let Some(expires) = expires_at {
            expiries.push((expires, 1));
        }
    }
    let available = data
        .get("available_count")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(live);
    Some(QuotaResetCredits {
        available,
        expirations: group_reset_expiries(expiries),
    })
}

pub(super) fn quota_from_codex_rate_limits_response(
    response: CodexRateLimitsResponse,
) -> QuotaInfo {
    let mut windows = Vec::new();
    let plan_type = response
        .rate_limits
        .as_ref()
        .and_then(|limits| limits.plan_type.as_deref())
        .map(str::trim)
        .filter(|plan| !plan.is_empty())
        .unwrap_or("codex")
        .to_lowercase();
    if let Some(rate_limits) = response.rate_limits {
        let primary_fallback: fn(f64, Option<String>) -> QuotaWindow =
            if rate_limits.secondary.is_some() {
                QuotaWindow::session
            } else {
                QuotaWindow::weekly
            };
        if let Some(primary) = rate_limits.primary {
            if let Some(used_percent) = primary.used_percent {
                windows.push(codex_quota_window(
                    used_percent,
                    primary.resets_at.and_then(unix_seconds_to_rfc3339),
                    primary.window_duration_mins,
                    primary_fallback,
                ));
            }
        }
        if let Some(secondary) = rate_limits.secondary {
            if let Some(used_percent) = secondary.used_percent {
                windows.push(codex_quota_window(
                    used_percent,
                    secondary.resets_at.and_then(unix_seconds_to_rfc3339),
                    secondary.window_duration_mins,
                    QuotaWindow::weekly,
                ));
            }
        }
    }

    let mut quota = quota_from_windows(&plan_type, "codex_app_server", windows);
    if let Some(limits) = response.rate_limits_by_limit_id {
        // App-server identifies the reserve by limit id, without the usage API's
        // normal_model_slug. Only this known mapping is safe to infer.
        if let Some(reserve) = limits.get(super::reserve::RESERVE_MODEL) {
            if let Some(pool) = model_quota(
                super::reserve::LUNA_MODEL,
                super::reserve::RESERVE_MODEL,
                reserve,
            ) {
                quota.model_quotas.push(pool);
            }
        }
    }
    if let Some(reset_credits) = response.rate_limit_reset_credits {
        quota.named_message = format_codex_reset_credits(&reset_credits);
        quota.reset_credits = codex_app_server_reset_credits(reset_credits);
    }
    quota
}

fn codex_next_expiry(reset_credits: &CodexRateLimitResetCredits) -> Option<String> {
    reset_credits
        .next_expires_at
        .as_ref()
        .and_then(|value| match value {
            serde_json::Value::Number(number) => number.as_i64().and_then(unix_seconds_to_rfc3339),
            serde_json::Value::String(value) => Some(value.clone()),
            _ => None,
        })
}

/// The app-server reports only the next expiry; at least one credit expires then.
fn codex_app_server_reset_credits(
    reset_credits: CodexRateLimitResetCredits,
) -> Option<QuotaResetCredits> {
    let available = reset_credits.available_count?;
    let expirations = codex_next_expiry(&reset_credits)
        .filter(|_| available > 0)
        .map(|expires_at| QuotaResetExpiry {
            count: 1,
            expires_at: normalize_reset_time(&expires_at).unwrap_or(expires_at),
        })
        .into_iter()
        .collect();
    Some(QuotaResetCredits {
        available,
        expirations,
    })
}

fn format_codex_reset_credits(reset_credits: &CodexRateLimitResetCredits) -> Option<String> {
    let available = reset_credits.available_count?;
    let summary = match reset_credits.total_earned_count {
        Some(total) => format!("Reset credits available: {available} (total earned: {total})"),
        None => format!("Reset credits available: {available}"),
    };
    let expiry = codex_next_expiry(reset_credits);

    match expiry {
        Some(expires_at) => Some(format!("{summary}, next expires {expires_at}")),
        None => Some(summary),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_usage_api_maps_primary_and_secondary_windows() {
        let payload = serde_json::json!({
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": { "used_percent": 25.0, "reset_at": 1_783_418_400 },
                "secondary_window": { "used_percent": 60.0, "resets_at": 1_783_938_000 }
            }
        });

        let quota = quota_from_usage_json(&payload).expect("usage windows");

        assert_eq!(quota.plan_type.as_deref(), Some("plus"));
        assert_eq!(quota.quota_source.as_deref(), Some("codex_usage_api"));
        assert_eq!(quota.usage_items.len(), 2);
        assert_eq!(quota.usage_items[0].usage_type, "session");
        assert!((quota.usage_items[0].remaining_percentage - 75.0).abs() < 0.01);
        assert_eq!(
            quota.usage_items[0].reset_time.as_deref(),
            Some("2026-07-07T10:00:00Z")
        );
        assert_eq!(quota.usage_items[1].usage_type, "weekly");
        assert!((quota.usage_items[1].remaining_percentage - 40.0).abs() < 0.01);
        assert_eq!(
            quota.usage_items[1].reset_time.as_deref(),
            Some("2026-07-13T10:20:00Z")
        );
        assert!((quota.remaining_percentage - 40.0).abs() < 0.01);
    }

    #[test]
    fn codex_usage_api_rejects_missing_windows() {
        let payload = serde_json::json!({
            "plan_type": "plus",
            "rate_limit": { "limit_reached": false }
        });
        assert!(quota_from_usage_json(&payload).is_none());
    }

    #[test]
    fn codex_usage_api_maps_five_hour_and_seven_day_windows() {
        let payload = serde_json::json!({
            "plan_type": "pro",
            "five_hour": { "utilization": 10.0, "resets_at": "2026-07-07T18:00:00+08:00" },
            "seven_day": { "utilization": 55.0, "resets_at": "2026-07-13T18:00:00+08:00" }
        });

        let quota = quota_from_usage_json(&payload).expect("usage windows");

        assert_eq!(quota.plan_type.as_deref(), Some("pro"));
        assert_eq!(quota.usage_items.len(), 2);
        assert_eq!(quota.usage_items[0].usage_type, "session");
        assert!((quota.usage_items[0].remaining_percentage - 90.0).abs() < 0.01);
        assert_eq!(
            quota.usage_items[0].reset_time.as_deref(),
            Some("2026-07-07T10:00:00Z")
        );
        assert_eq!(quota.usage_items[1].usage_type, "weekly");
        assert!((quota.usage_items[1].remaining_percentage - 45.0).abs() < 0.01);
        assert_eq!(
            quota.usage_items[1].reset_time.as_deref(),
            Some("2026-07-13T10:00:00Z")
        );
    }

    #[test]
    fn app_server_preserves_reported_plan_type() {
        for plan in ["pro", "prolite"] {
            let response = serde_json::from_value::<CodexRateLimitsResponse>(serde_json::json!({
                "rateLimits": {"planType": plan}
            }))
            .unwrap();
            let quota = quota_from_codex_rate_limits_response(response);
            assert_eq!(quota.plan_type.as_deref(), Some(plan));
        }
    }

    #[test]
    fn usage_api_preserves_available_reset_credits_without_inventing_zero() {
        for (credits, expected) in [
            (
                serde_json::json!({"available_count": 3}),
                Some("Reset credits available: 3"),
            ),
            (
                serde_json::json!({"available_count": 0}),
                Some("Reset credits available: 0"),
            ),
            (serde_json::json!({}), None),
            (serde_json::Value::Null, None),
            (serde_json::json!({"available_count": -1}), None),
        ] {
            let quota = quota_from_usage_json(&serde_json::json!({
                "plan_type": "pro",
                "seven_day": {"utilization": 13},
                "rate_limit_reset_credits": credits
            }))
            .unwrap();
            assert_eq!(quota.named_message.as_deref(), expected);
            assert_eq!(quota.plan_type.as_deref(), Some("pro"));
        }
        assert_eq!(
            format_codex_reset_credits(&CodexRateLimitResetCredits {
                available_count: None,
                total_earned_count: Some(3),
                next_expires_at: None,
            }),
            None
        );
    }

    #[test]
    fn codex_rate_limits_response_maps_windows_and_reset_credits() {
        let response = CodexRateLimitsResponse {
            rate_limits_by_limit_id: None,
            rate_limits: Some(CodexRateLimitsPayload {
                plan_type: None,
                primary: Some(CodexRateLimitWindow {
                    used_percent: Some(30.0),
                    window_duration_mins: Some(300),
                    resets_at: Some(1_783_418_400),
                }),
                secondary: Some(CodexRateLimitWindow {
                    used_percent: Some(65.0),
                    window_duration_mins: Some(10_080),
                    resets_at: Some(1_783_938_000),
                }),
            }),
            rate_limit_reset_credits: Some(CodexRateLimitResetCredits {
                available_count: Some(2),
                total_earned_count: Some(3),
                next_expires_at: Some(serde_json::json!(1_783_418_400)),
            }),
        };

        let quota = quota_from_codex_rate_limits_response(response);

        assert_eq!(quota.plan_type.as_deref(), Some("codex"));
        assert_eq!(quota.quota_source.as_deref(), Some("codex_app_server"));
        assert_eq!(quota.reset_time.as_deref(), Some("2026-07-07T10:00:00Z"));
        assert!((quota.remaining_percentage - 35.0).abs() < 0.01);
        assert_eq!(quota.usage_items.len(), 2);
        assert_eq!(quota.usage_items[0].usage_type, "session");
        assert_eq!(quota.usage_items[1].usage_type, "weekly");
        assert_eq!(
            quota.named_message.as_deref(),
            Some("Reset credits available: 2 (total earned: 3), next expires 2026-07-07T10:00:00Z")
        );
        assert_eq!(
            quota.reset_credits,
            Some(QuotaResetCredits {
                available: 2,
                expirations: vec![QuotaResetExpiry {
                    count: 1,
                    expires_at: "2026-07-07T10:00:00Z".to_string(),
                }],
            })
        );
    }

    #[test]
    fn reset_credit_list_reports_each_live_credit_expiry() {
        let now = DateTime::parse_from_rfc3339("2026-09-24T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let credits = reset_credits_from_list_json(
            &serde_json::json!({
                "credits": [
                    { "status": "available", "is_supported_by_plan": true,
                      "expires_at": "2026-10-22T21:00:27.720619Z" },
                    { "status": "available", "is_supported_by_plan": true,
                      "expires_at": "2026-10-04T05:38:12.491791Z" },
                    { "status": "redeemed", "expires_at": "2026-10-01T00:00:00Z" },
                    { "status": "available", "is_supported_by_plan": false,
                      "expires_at": "2026-10-01T00:00:00Z" },
                    { "status": "available", "expires_at": "2026-09-01T00:00:00Z" }
                ],
                "total_earned_count": 0
            }),
            now,
        )
        .unwrap();

        assert_eq!(credits.available, 2);
        assert_eq!(
            credits.expirations,
            vec![
                QuotaResetExpiry {
                    count: 1,
                    expires_at: "2026-10-04T05:38:12Z".to_string(),
                },
                QuotaResetExpiry {
                    count: 1,
                    expires_at: "2026-10-22T21:00:27Z".to_string(),
                },
            ]
        );
        assert_eq!(
            credits.summary(),
            "Reset credits available: 2, next expires 2026-10-04T05:38:12Z"
        );
    }

    #[test]
    fn reset_credit_list_prefers_reported_available_count() {
        let credits = reset_credits_from_list_json(
            &serde_json::json!({ "credits": [], "available_count": 3 }),
            Utc::now(),
        )
        .unwrap();
        assert_eq!(credits.available, 3);
        assert!(credits.expirations.is_empty());
        assert_eq!(
            reset_credits_from_list_json(&serde_json::json!({}), Utc::now()),
            None
        );
    }

    #[test]
    fn codex_rate_limits_response_classifies_lone_weekly_primary_by_duration() {
        let quota = quota_from_codex_rate_limits_response(CodexRateLimitsResponse {
            rate_limits_by_limit_id: None,
            rate_limits: Some(CodexRateLimitsPayload {
                plan_type: None,
                primary: Some(CodexRateLimitWindow {
                    used_percent: Some(44.0),
                    window_duration_mins: Some(10_080),
                    resets_at: Some(1_783_938_000),
                }),
                secondary: None,
            }),
            rate_limit_reset_credits: None,
        });

        assert_eq!(quota.usage_items.len(), 1);
        assert_eq!(quota.usage_items[0].usage_type, "weekly");
        assert!((quota.usage_items[0].remaining_percentage - 56.0).abs() < 0.01);
    }

    #[test]
    fn codex_usage_api_classifies_primary_window_by_duration() {
        let payload = serde_json::json!({
            "plan_type": "pro",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 44.0,
                    "window_duration_mins": 10_080,
                    "reset_at": 1_783_938_000
                }
            }
        });

        let quota = quota_from_usage_json(&payload).expect("weekly window");

        assert_eq!(quota.usage_items.len(), 1);
        assert_eq!(quota.usage_items[0].usage_type, "weekly");
        assert!((quota.usage_items[0].remaining_percentage - 56.0).abs() < 0.01);
    }

    #[test]
    fn codex_usage_api_treats_legacy_lone_primary_as_weekly() {
        let payload = serde_json::json!({
            "plan_type": "pro",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 44.0,
                    "reset_at": 1_783_938_000
                }
            }
        });

        let quota = quota_from_usage_json(&payload).expect("weekly window");

        assert_eq!(quota.usage_items.len(), 1);
        assert_eq!(quota.usage_items[0].usage_type, "weekly");
    }

    #[test]
    fn codex_rate_limits_response_handles_missing_payload() {
        let quota = quota_from_codex_rate_limits_response(CodexRateLimitsResponse {
            rate_limits_by_limit_id: None,
            rate_limits: None,
            rate_limit_reset_credits: None,
        });

        assert_eq!(quota.remaining_percentage, 100.0);
        assert!(quota.usage_items.is_empty());
    }
}
