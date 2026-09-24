//! Codex's distinct Luna reserve model and its reported quota identity.
//! Requests explicitly select this model; ordinary Luna is never rewritten.
pub const LUNA_MODEL: &str = "gpt-5.6-luna";
pub const RESERVE_MODEL: &str = "gpt-reserve";
pub const EXPOSURE_HEADER: &str = "x-openai-codex-luna-reserve";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    fn usage() -> Value {
        json!({"rate_limit": {"allowed": false, "limit_reached": true,
        "primary_window": {"used_percent": 100, "limit_window_seconds": 604800}},
        "additional_rate_limits": [{"limit_name": RESERVE_MODEL,
            "normal_model_slug": LUNA_MODEL, "rate_limit": {
                "allowed": true, "limit_reached": false,
                "primary_window": {"used_percent": 3, "limit_window_seconds": 604800}, "secondary_window": null
            }}]})
    }

    #[test]
    fn ingestion_preserves_reserve_without_inflating_ordinary_quota() {
        let quota = super::super::quota::quota_from_usage_json(&usage()).unwrap();
        assert_eq!(quota.remaining_percentage, 0.0);
        assert_eq!(quota.model_quotas.len(), 1);
        assert_eq!(quota.model_quotas[0].model, LUNA_MODEL);
        assert_eq!(
            quota.model_quotas[0].usage_items[0].remaining_percentage,
            97.0
        );
        let persisted = serde_json::to_value(&quota).unwrap();
        let restored: crate::types::QuotaInfo = serde_json::from_value(persisted).unwrap();
        assert_eq!(restored.model_quotas[0].limit_id, RESERVE_MODEL);
    }
    #[test]
    fn app_server_preserves_reserve_pool_but_missing_permission_is_unknown() {
        let response = serde_json::from_value(json!({
            "rateLimits": {"primary": {"usedPercent": 100, "windowDurationMins": 10080}},
            "rateLimitsByLimitId": { "gpt-reserve": {
                "primary": {"usedPercent": 3, "windowDurationMins": 10080, "resetsAt": 1890000000}, "secondary": null
            }}
        }))
        .unwrap();
        let quota = super::super::quota::quota_from_codex_rate_limits_response(response);
        assert_eq!(quota.remaining_percentage, 0.0);
        let pool = &quota.model_quotas[0];
        assert_eq!(pool.model, LUNA_MODEL);
        assert_eq!(pool.allowed, None);
        assert_eq!(pool.usage_items[0].remaining_percentage, 97.0);
        assert!(pool.usage_items[0].reset_time.is_some());
    }
    #[test]
    fn reserve_only_payloads_leave_ordinary_quota_unknown_in_both_sources() {
        let mut payload = usage();
        payload.as_object_mut().unwrap().remove("rate_limit");
        let usage_quota = super::super::quota::quota_from_usage_json(&payload).unwrap();
        let response = serde_json::from_value(json!({
            "rateLimitsByLimitId": { "gpt-reserve": {
                "primary": {"usedPercent": 3, "windowDurationMins": 10080},
                "secondary": null
            }}
        }))
        .unwrap();
        let app_server_quota = super::super::quota::quota_from_codex_rate_limits_response(response);
        for (quota, source) in [
            (usage_quota, "codex_usage_api"),
            (app_server_quota, "codex_app_server"),
        ] {
            assert_eq!(quota.remaining_percentage, -1.0);
            assert_eq!(quota.used, None);
            assert_eq!(quota.limit, None);
            assert_eq!(quota.remaining, None);
            assert!(quota.usage_items.is_empty());
            assert_eq!(quota.quota_source.as_deref(), Some(source));
            assert!(quota.plan_type.is_some());
            assert_eq!(quota.model_quotas.len(), 1);
            assert_eq!(quota.model_quotas[0].limit_id, RESERVE_MODEL);
            assert_eq!(quota.model_quotas[0].usage_items[0].remaining_percentage, 97.0);
        }
    }

    #[test]
    fn malformed_reserve_windows_cannot_be_persisted_as_capacity() {
        for percent in [json!(-1), json!(101), Value::Null, json!("97")] {
            let mut payload = usage();
            payload["additional_rate_limits"][0]["rate_limit"]["primary_window"]["used_percent"] =
                percent;
            let quota = super::super::quota::quota_from_usage_json(&payload).unwrap();
            assert!(quota.model_quotas.is_empty());
            assert_eq!(quota.remaining_percentage, 0.0);
        }
        let mut payload = usage();
        payload["additional_rate_limits"][0]["rate_limit"]["primary_window"]["used_percent"] =
            json!(100);
        payload["additional_rate_limits"][0]["rate_limit"]["allowed"] = json!(false);
        payload["additional_rate_limits"][0]["rate_limit"]["limit_reached"] = json!(true);
        let quota = super::super::quota::quota_from_usage_json(&payload).unwrap();
        assert_eq!(
            quota.model_quotas[0].usage_items[0].remaining_percentage,
            0.0
        );
        assert_eq!(quota.model_quotas[0].allowed, Some(false));
        assert_eq!(quota.model_quotas[0].limit_reached, Some(true));
    }
}
