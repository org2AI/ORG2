//! Zhipu (BigModel / Z.ai) GLM Coding Plan quota fetching.
//!
//! Zhipu exposes coding-plan usage/quota via a `monitor` API, mirrored from the
//! official `zai-org/zai-coding-plugins` (`glm-plan-usage`) plugin:
//!   - Quota limit: `{base}/api/monitor/usage/quota/limit`
//!
//! Auth uses the raw API key in the `Authorization` header (no `Bearer` prefix).
//!
//! The endpoint returns two prompt windows — the 5-hour window and the weekly
//! window — plus a `TIME_LIMIT` monthly MCP allowance that we ignore. Each
//! window carries its length as a `(unit, number)` pair and, once the window
//! has been touched, a `nextResetTime` in epoch milliseconds. Pay-as-you-go API
//! keys have no coding-plan quota; for those the endpoint returns 4xx or empty
//! limits and we surface a "Pay-as-you-go" `QuotaInfo` (unlimited, no usage
//! bar) instead of an error.

use chrono::{DateTime, TimeDelta, Utc};
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

use crate::providers::quota_windows::{json_time_to_rfc3339, quota_from_windows, QuotaWindow};
use crate::types::QuotaInfo;

const HTTP_TIMEOUT_SECS: u64 = 15;

/// Default host when the key has no stored base URL (China / BigModel).
const DEFAULT_HOST: &str = "https://open.bigmodel.cn";
/// Global (Z.ai) host.
const ZAI_HOST: &str = "https://api.z.ai";

/// The monitor endpoint types the 5-hour and weekly prompt windows as
/// `CREDIT_LIMIT`; older plans still answer with the previous `TOKENS_LIMIT`
/// name for the same shape. `TIME_LIMIT` is the monthly MCP allowance, which we
/// intentionally do not surface.
const CREDIT_LIMIT_TYPE: &str = "CREDIT_LIMIT";
const TOKENS_LIMIT_TYPE: &str = "TOKENS_LIMIT";

/// Window-length unit codes used by the `(unit, number)` pair on each limit.
///
/// Only the units actually observed on a prompt window are mapped. Unit `5` is
/// deliberately absent: it appears solely on the `TIME_LIMIT` MCP allowance we
/// ignore, and independent implementations disagree on whether it means minutes
/// or months. Guessing would misfile a window; leaving it unknown falls back to
/// the payload order instead.
const UNIT_HOURS: i64 = 3;
const UNIT_DAYS: i64 = 4;
const UNIT_WEEKS: i64 = 6;

const MINUTES_PER_HOUR: f64 = 60.0;
const MINUTES_PER_DAY: f64 = 24.0 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK: f64 = 7.0 * MINUTES_PER_DAY;

/// Slack allowed when checking a reset against its own window, so a reset that
/// lands exactly at the window edge is not discarded by clock skew.
const RESET_PLAUSIBILITY_MARGIN_MINUTES: i64 = 1;

const SESSION_USAGE_TYPE: &str = "session";
const WEEKLY_USAGE_TYPE: &str = "weekly";
const QUOTA_SOURCE: &str = "zhipu_monitor";
const PLAN_TYPE_CODING: &str = "GLM Coding Plan";
const PLAN_TYPE_PAYG: &str = "Pay-as-you-go";

/// `{ "data": { "limits": [...] } }` wrapper returned by the monitor endpoint.
#[derive(Debug, Deserialize)]
struct QuotaLimitEnvelope {
    #[serde(default)]
    data: Option<QuotaLimitData>,
}

#[derive(Debug, Deserialize)]
struct QuotaLimitData {
    #[serde(default)]
    limits: Vec<QuotaLimit>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaLimit {
    /// `CREDIT_LIMIT`/`TOKENS_LIMIT` (the 5-hour and weekly prompt windows) or
    /// `TIME_LIMIT` (monthly MCP allowance, which we ignore).
    #[serde(default)]
    r#type: Option<String>,
    /// Some revisions carry the limit kind under `name` instead of `type`.
    #[serde(default)]
    name: Option<String>,
    /// Percentage of the window consumed (0-100).
    #[serde(default)]
    percentage: Option<f64>,
    /// Unit of the window length: hours (3), days (4), months (5), weeks (6).
    #[serde(default)]
    unit: Option<f64>,
    /// Window length, counted in `unit`s (e.g. `unit: 3, number: 5` = 5 hours).
    #[serde(default)]
    number: Option<f64>,
    /// When the window next refills, as epoch milliseconds. Absent while a
    /// window is untouched — there is nothing to reset until it is first used.
    #[serde(default, alias = "next_reset_time")]
    next_reset_time: Option<Value>,
}

impl QuotaLimit {
    fn limit_type(&self) -> &str {
        self.r#type
            .as_deref()
            .or(self.name.as_deref())
            .map(str::trim)
            .unwrap_or_default()
    }

    /// True for the percentage prompt windows, under either type name.
    fn is_prompt_window(&self) -> bool {
        let limit_type = self.limit_type();
        limit_type.eq_ignore_ascii_case(CREDIT_LIMIT_TYPE)
            || limit_type.eq_ignore_ascii_case(TOKENS_LIMIT_TYPE)
    }

    /// The window length in minutes, or `None` when the payload omits the pair
    /// or uses a unit we do not know.
    fn window_minutes(&self) -> Option<f64> {
        let unit = self.unit.filter(|unit| unit.is_finite())?;
        let number = self
            .number
            .filter(|number| number.is_finite() && *number > 0.0)?;
        let minutes_per_unit = match unit as i64 {
            UNIT_HOURS => MINUTES_PER_HOUR,
            UNIT_DAYS => MINUTES_PER_DAY,
            UNIT_WEEKS => MINUTES_PER_WEEK,
            _ => return None,
        };
        Some(number * minutes_per_unit)
    }

    /// The window's reset instant as RFC 3339, normalized from epoch
    /// milliseconds (seconds and RFC 3339 strings are tolerated too).
    ///
    /// A reset further out than the window is long is dropped rather than
    /// shown: Zhipu has been observed answering a 5-hour window with a reset
    /// roughly ten hours away, and a window cannot outlast its own length. We
    /// do not try to correct it — an absent reset falls back to the
    /// "next use +5h" hint, which is honest; a wrong timestamp is not.
    fn reset_time(&self, now: DateTime<Utc>) -> Option<String> {
        let reset = self
            .next_reset_time
            .as_ref()
            .and_then(json_time_to_rfc3339)?;
        let Some(window_minutes) = self.window_minutes() else {
            // No declared length, so nothing to judge the reset against.
            return Some(reset);
        };
        let horizon = TimeDelta::try_minutes(
            (window_minutes.ceil() as i64).saturating_add(RESET_PLAUSIBILITY_MARGIN_MINUTES),
        )
        .map(|delta| now + delta)?;
        let parsed = DateTime::parse_from_rfc3339(&reset)
            .ok()?
            .with_timezone(&Utc);
        (parsed <= horizon).then_some(reset)
    }
}

/// Zhipu GLM Coding Plan quota fetcher.
pub struct ZhipuQuotaFetcher {
    client: reqwest::Client,
    http_timeout: Duration,
}

impl ZhipuQuotaFetcher {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            http_timeout: Duration::from_secs(HTTP_TIMEOUT_SECS),
        }
    }

    /// Resolve the monitor API host from the key's stored base URL.
    ///
    /// Global (Z.ai) keys use `api.z.ai`; everything else (BigModel China,
    /// including `dev.bigmodel.cn`) falls back to `open.bigmodel.cn`.
    fn resolve_host(base_url: Option<&str>) -> &'static str {
        match base_url {
            Some(url) if url.contains("z.ai") => ZAI_HOST,
            _ => DEFAULT_HOST,
        }
    }

    /// Fetch GLM Coding Plan quota for a Zhipu API key.
    ///
    /// # Arguments
    /// * `api_key` - Zhipu API key (coding-plan or pay-as-you-go).
    /// * `base_url` - The key's stored base URL, used to pick China vs Global host.
    pub async fn fetch_quota(
        &self,
        api_key: &str,
        base_url: Option<&str>,
    ) -> Result<QuotaInfo, String> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err("No API key provided".to_string());
        }

        let host = Self::resolve_host(base_url);
        let url = format!("{host}/api/monitor/usage/quota/limit");

        let response = self
            .client
            .get(&url)
            .header("Authorization", api_key)
            .header("Accept-Language", "en-US,en")
            .header("Content-Type", "application/json")
            .timeout(self.http_timeout)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        let status = response.status();

        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err("Zhipu API key is invalid or expired".to_string());
        }

        // A non-plan (pay-as-you-go) key has no coding-plan quota; the monitor
        // endpoint rejects it. Surface a Pay-as-you-go card instead of an error.
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
            return Ok(payg_quota());
        }

        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }

        let envelope: QuotaLimitEnvelope = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;

        let limits = envelope.data.map(|data| data.limits).unwrap_or_default();

        Ok(parse_quota_limits(limits))
    }
}

impl Default for ZhipuQuotaFetcher {
    fn default() -> Self {
        Self::new()
    }
}

/// Build a Pay-as-you-go `QuotaInfo` (no coding-plan quota to report).
fn payg_quota() -> QuotaInfo {
    QuotaInfo {
        remaining_percentage: 100.0,
        is_unlimited: true,
        plan_type: Some(PLAN_TYPE_PAYG.to_string()),
        quota_source: Some(QUOTA_SOURCE.to_string()),
        ..Default::default()
    }
}

/// Parse the monitor `limits[]` into a `QuotaInfo`.
///
/// The prompt windows map to `session` (sub-daily) and `weekly` (multi-day),
/// each carrying its own `nextResetTime`. Windows are classified by their
/// declared `(unit, number)` length so a reset lands on the right bar; payloads
/// that omit the pair fall back to the documented order (5-hour first, weekly
/// second). `TIME_LIMIT` (monthly MCP) is ignored.
fn parse_quota_limits(limits: Vec<QuotaLimit>) -> QuotaInfo {
    parse_quota_limits_at(limits, Utc::now())
}

fn parse_quota_limits_at(limits: Vec<QuotaLimit>, now: DateTime<Utc>) -> QuotaInfo {
    let prompt_windows: Vec<&QuotaLimit> = limits
        .iter()
        .filter(|limit| limit.is_prompt_window())
        .collect();

    // No prompt windows → pay-as-you-go (no coding-plan quota).
    if prompt_windows.is_empty() {
        return payg_quota();
    }

    let mut session: Option<&QuotaLimit> = None;
    let mut weekly: Option<&QuotaLimit> = None;
    let mut unclassified: Vec<&QuotaLimit> = Vec::new();

    for limit in prompt_windows {
        let slot = match limit.window_minutes() {
            Some(minutes) if minutes < MINUTES_PER_DAY => &mut session,
            Some(_) => &mut weekly,
            None => {
                unclassified.push(limit);
                continue;
            }
        };
        if slot.is_none() {
            *slot = Some(limit);
        } else {
            unclassified.push(limit);
        }
    }

    // Older payloads carry no `(unit, number)` pair; they list the 5-hour window
    // first and the weekly window second.
    for limit in unclassified {
        if session.is_none() {
            session = Some(limit);
        } else if weekly.is_none() {
            weekly = Some(limit);
        }
    }

    let windows: Vec<QuotaWindow> = [
        session.map(|limit| (SESSION_USAGE_TYPE, limit)),
        weekly.map(|limit| (WEEKLY_USAGE_TYPE, limit)),
    ]
    .into_iter()
    .flatten()
    .map(|(usage_type, limit)| QuotaWindow {
        usage_type,
        used_percent: limit.percentage.unwrap_or(0.0),
        reset_time: limit.reset_time(now),
    })
    .collect();

    quota_from_windows(PLAN_TYPE_CODING, QUOTA_SOURCE, windows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Parse a captured `data` object the way `fetch_quota` does.
    fn limits_from(data: serde_json::Value) -> Vec<QuotaLimit> {
        serde_json::from_value::<QuotaLimitData>(data)
            .expect("limits payload should deserialize")
            .limits
    }

    /// A fixed clock, so the reset-plausibility check does not drift with the
    /// wall clock. Each test pins one consistent with its payload's capture.
    fn at(now: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(now)
            .expect("fixture clock should parse")
            .with_timezone(&Utc)
    }

    /// Parse against a pinned clock.
    fn parse_at(now: &str, data: serde_json::Value) -> QuotaInfo {
        parse_quota_limits_at(limits_from(data), at(now))
    }

    /// Parse a payload that carries no reset, where the clock cannot matter.
    fn parse(data: serde_json::Value) -> QuotaInfo {
        parse_at("2026-06-29T09:00:00Z", data)
    }

    #[test]
    fn resolve_host_defaults_to_bigmodel() {
        assert_eq!(ZhipuQuotaFetcher::resolve_host(None), DEFAULT_HOST);
        assert_eq!(
            ZhipuQuotaFetcher::resolve_host(Some("https://open.bigmodel.cn/api/paas/v4")),
            DEFAULT_HOST
        );
        assert_eq!(
            ZhipuQuotaFetcher::resolve_host(Some("https://dev.bigmodel.cn/api/paas/v4")),
            DEFAULT_HOST
        );
    }

    #[test]
    fn resolve_host_picks_zai_for_global() {
        assert_eq!(
            ZhipuQuotaFetcher::resolve_host(Some("https://api.z.ai/api/paas/v4")),
            ZAI_HOST
        );
        assert_eq!(
            ZhipuQuotaFetcher::resolve_host(Some("https://api.z.ai/api/anthropic")),
            ZAI_HOST
        );
    }

    #[test]
    fn empty_limits_is_payg() {
        let quota = parse_quota_limits_at(Vec::new(), at("2026-06-29T09:00:00Z"));
        assert_eq!(quota.plan_type.as_deref(), Some(PLAN_TYPE_PAYG));
        assert!(quota.is_unlimited);
        assert!(quota.usage_items.is_empty());
    }

    #[test]
    fn tokens_limit_drives_session_window() {
        let quota = parse(json!({
            "limits": [{ "type": TOKENS_LIMIT_TYPE, "percentage": 25.0 }]
        }));
        assert_eq!(quota.plan_type.as_deref(), Some(PLAN_TYPE_CODING));
        assert!(!quota.is_unlimited);
        assert!((quota.remaining_percentage - 75.0).abs() < f64::EPSILON);
        assert_eq!(quota.usage_items.len(), 1);
        assert_eq!(quota.usage_items[0].usage_type, SESSION_USAGE_TYPE);
    }

    #[test]
    fn two_windows_map_to_session_and_weekly() {
        // Without a `(unit, number)` pair the order decides: first TOKENS_LIMIT
        // → session (5h), second → weekly. TIME_LIMIT ignored.
        let quota = parse(json!({
            "limits": [
                { "type": TOKENS_LIMIT_TYPE, "percentage": 0.0 },
                { "type": TOKENS_LIMIT_TYPE, "percentage": 72.0 },
                { "type": "TIME_LIMIT", "percentage": 3.0 }
            ]
        }));
        assert_eq!(quota.usage_items.len(), 2);
        assert_eq!(quota.usage_items[0].usage_type, SESSION_USAGE_TYPE);
        assert!((quota.usage_items[0].remaining_percentage - 100.0).abs() < f64::EPSILON);
        assert_eq!(quota.usage_items[1].usage_type, WEEKLY_USAGE_TYPE);
        assert!((quota.usage_items[1].remaining_percentage - 28.0).abs() < f64::EPSILON);
        // No MCP item.
        assert!(quota
            .usage_items
            .iter()
            .all(|item| item.usage_type != "mcp"));
    }

    #[test]
    fn time_limit_only_is_payg() {
        // Only a monthly MCP window and no prompt windows → pay-as-you-go.
        let quota = parse(json!({
            "limits": [{ "type": "TIME_LIMIT", "percentage": 40.0 }]
        }));
        assert_eq!(quota.plan_type.as_deref(), Some(PLAN_TYPE_PAYG));
        assert!(quota.is_unlimited);
        assert!(quota.usage_items.is_empty());
    }

    #[test]
    fn reset_times_come_from_next_reset_time_in_epoch_millis() {
        // Shape captured from a live GLM Coding Pro response: both prompt
        // windows carry their own epoch-millisecond `nextResetTime`.
        let quota = parse_at(
            "2026-06-29T09:00:00Z",
            json!({
            "limits": [
                {
                    "type": TOKENS_LIMIT_TYPE,
                    "unit": 3,
                    "number": 5,
                    "percentage": 17,
                    "nextResetTime": 1782724971179u64
                },
                {
                    "type": TOKENS_LIMIT_TYPE,
                    "unit": 6,
                    "number": 1,
                    "percentage": 3,
                    "nextResetTime": 1783305486997u64
                },
                {
                    "type": "TIME_LIMIT",
                    "unit": 5,
                    "number": 1,
                    "percentage": 0,
                    "nextResetTime": 1785292686976u64
                }
            ]
            }),
        );

        assert_eq!(quota.usage_items.len(), 2);
        assert_eq!(quota.usage_items[0].usage_type, SESSION_USAGE_TYPE);
        assert_eq!(
            quota.usage_items[0].reset_time.as_deref(),
            Some("2026-06-29T09:22:51Z")
        );
        assert_eq!(quota.usage_items[1].usage_type, WEEKLY_USAGE_TYPE);
        assert_eq!(
            quota.usage_items[1].reset_time.as_deref(),
            Some("2026-07-06T02:38:06Z")
        );
        // The card-level reset falls back to the first window that has one.
        assert_eq!(quota.reset_time.as_deref(), Some("2026-06-29T09:22:51Z"));
    }

    #[test]
    fn credit_limit_windows_are_classified_by_declared_length() {
        // Shape captured from a live GLM Coding Lite response: the newer
        // CREDIT_LIMIT type, weekly window listed second, and an untouched
        // 5-hour window with no reset yet.
        let quota = parse_at(
            "2026-08-13T06:00:00Z",
            json!({
                "limits": [
                    {
                        "type": CREDIT_LIMIT_TYPE,
                        "unit": 6,
                        "number": 1,
                        "percentage": 98,
                        "nextResetTime": 1786685679998u64
                    },
                    {
                        "type": CREDIT_LIMIT_TYPE,
                        "unit": 3,
                        "number": 5,
                        "percentage": 0
                    }
                ]
            }),
        );

        assert_eq!(quota.plan_type.as_deref(), Some(PLAN_TYPE_CODING));
        assert_eq!(quota.usage_items.len(), 2);
        // Declared window length wins over payload order.
        assert_eq!(quota.usage_items[0].usage_type, SESSION_USAGE_TYPE);
        assert!((quota.usage_items[0].remaining_percentage - 100.0).abs() < f64::EPSILON);
        assert!(quota.usage_items[0].reset_time.is_none());
        assert_eq!(quota.usage_items[1].usage_type, WEEKLY_USAGE_TYPE);
        assert!((quota.usage_items[1].remaining_percentage - 2.0).abs() < f64::EPSILON);
        assert_eq!(
            quota.usage_items[1].reset_time.as_deref(),
            Some("2026-08-14T05:34:39Z")
        );
        assert_eq!(quota.reset_time.as_deref(), Some("2026-08-14T05:34:39Z"));
    }

    #[test]
    fn unknown_window_units_fall_back_to_payload_order() {
        // A unit we do not recognize must not drop the window; it keeps its
        // documented position instead.
        let quota = parse(json!({
            "limits": [
                { "type": CREDIT_LIMIT_TYPE, "unit": 99, "number": 1, "percentage": 10 },
                { "type": CREDIT_LIMIT_TYPE, "unit": 99, "number": 1, "percentage": 40 }
            ]
        }));

        assert_eq!(quota.usage_items.len(), 2);
        assert_eq!(quota.usage_items[0].usage_type, SESSION_USAGE_TYPE);
        assert!((quota.usage_items[0].remaining_percentage - 90.0).abs() < f64::EPSILON);
        assert_eq!(quota.usage_items[1].usage_type, WEEKLY_USAGE_TYPE);
        assert!((quota.usage_items[1].remaining_percentage - 60.0).abs() < f64::EPSILON);
    }

    #[test]
    fn limit_kind_under_name_is_still_a_prompt_window() {
        let quota = parse(json!({
            "limits": [{ "name": CREDIT_LIMIT_TYPE, "unit": 3, "number": 5, "percentage": 12 }]
        }));
        assert_eq!(quota.usage_items.len(), 1);
        assert_eq!(quota.usage_items[0].usage_type, SESSION_USAGE_TYPE);
    }

    #[test]
    fn reset_time_accepts_seconds_and_rfc3339_strings() {
        let quota = parse_at(
            "2026-07-07T08:00:00Z",
            json!({
                "limits": [
                    {
                        "type": CREDIT_LIMIT_TYPE,
                        "unit": 3,
                        "number": 5,
                        "percentage": 5,
                        "nextResetTime": 1783418400u64
                    },
                    {
                        "type": CREDIT_LIMIT_TYPE,
                        "unit": 6,
                        "number": 1,
                        "percentage": 5,
                        "next_reset_time": "2026-07-10T18:00:00+08:00"
                    }
                ]
            }),
        );

        assert_eq!(
            quota.usage_items[0].reset_time.as_deref(),
            Some("2026-07-07T10:00:00Z")
        );
        assert_eq!(
            quota.usage_items[1].reset_time.as_deref(),
            Some("2026-07-10T10:00:00Z")
        );
    }

    #[test]
    fn reset_further_out_than_its_own_window_is_dropped() {
        // Zhipu has been seen answering a 5-hour window with a reset roughly
        // ten hours out. A window cannot outlast its own length, so the bogus
        // timestamp is dropped rather than shown or timezone-corrected.
        let quota = parse_at(
            "2026-07-07T08:00:00Z",
            json!({
                "limits": [
                    {
                        "type": CREDIT_LIMIT_TYPE,
                        "unit": 3,
                        "number": 5,
                        "percentage": 40,
                        "nextResetTime": 1783454400000u64
                    },
                    {
                        "type": CREDIT_LIMIT_TYPE,
                        "unit": 6,
                        "number": 1,
                        "percentage": 60,
                        "nextResetTime": 1783454400000u64
                    }
                ]
            }),
        );

        // The usage bars survive; only the implausible reset is withheld.
        assert_eq!(quota.usage_items.len(), 2);
        assert_eq!(quota.usage_items[0].usage_type, SESSION_USAGE_TYPE);
        assert!((quota.usage_items[0].remaining_percentage - 60.0).abs() < f64::EPSILON);
        assert!(quota.usage_items[0].reset_time.is_none());
        // The same instant is well inside the weekly window, so it is kept.
        assert_eq!(
            quota.usage_items[1].reset_time.as_deref(),
            Some("2026-07-07T20:00:00Z")
        );
    }

    #[test]
    fn reset_is_kept_when_the_window_length_is_unknown() {
        // Without a `(unit, number)` pair there is nothing to judge the reset
        // against, so it is reported as given rather than second-guessed.
        let quota = parse_at(
            "2026-07-07T08:00:00Z",
            json!({
                "limits": [{
                    "type": CREDIT_LIMIT_TYPE,
                    "percentage": 40,
                    "nextResetTime": 1784059200000u64
                }]
            }),
        );

        assert_eq!(
            quota.usage_items[0].reset_time.as_deref(),
            Some("2026-07-14T20:00:00Z")
        );
    }
}
