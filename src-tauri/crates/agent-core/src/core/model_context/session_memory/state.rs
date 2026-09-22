//! Per-session mutable state for session memory.

use std::time::{Duration, Instant};

use crate::providers::auxiliary_model::{AuxiliaryModel, MAX_AUXILIARY_CANDIDATES};
use crate::providers::traits::ProviderError;

const FAILURE_COOLDOWN: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ExtractionFailure {
    UnsupportedModel,
    Authentication,
    Other,
}

impl ExtractionFailure {
    fn warning(self) -> &'static str {
        match self {
            Self::UnsupportedModel => "Session memory model is unavailable for this account; extraction is paused briefly before retrying",
            Self::Authentication => "Session memory could not authenticate with the provider; check the account connection",
            Self::Other => "Session memory extraction did not complete; it will retry on a later turn",
        }
    }
}

/// Constant-size, session-owned state. New provider instances on later turns
/// share it; a different account/endpoint/model/catalog starts a new scope.
#[derive(Debug, Clone, Default)]
pub struct AuxiliaryRetryState {
    acquisition_scope: Option<u64>,
    route: Option<(u64, String, Vec<String>)>,
    rejected_candidates: u8,
    retry_after: Option<Instant>,
    failure: Option<ExtractionFailure>,
    last_warning: Option<(ExtractionFailure, Instant)>,
}

impl AuxiliaryRetryState {
    /// Gate the whole attempt, including provider construction and OAuth
    /// preflight. The scope comes from current routing metadata, not a client.
    pub fn begin_attempt(&mut self, scope: u64, now: Instant) -> bool {
        if self.acquisition_scope != Some(scope) {
            *self = Self {
                acquisition_scope: Some(scope),
                ..Self::default()
            };
        }
        if self.retry_after.is_some_and(|until| now < until) {
            return false;
        }
        self.failure = None;
        true
    }

    pub fn provider_failed(&mut self, error: &ProviderError, now: Instant) {
        self.failed(ExtractionFailure::from(error), now);
    }

    pub fn is_cooling_down(&self, selection: &AuxiliaryModel, parent: &str, now: Instant) -> bool {
        self.route
            .as_ref()
            .is_some_and(|(scope, previous_parent, candidate)| {
                *scope == selection.scope
                    && previous_parent == parent
                    && candidate == &selection.models
            })
            && self.retry_after.is_some_and(|until| now < until)
    }

    pub(super) fn select(
        &mut self,
        selection: AuxiliaryModel,
        parent: &str,
        now: Instant,
    ) -> Option<String> {
        let route = (selection.scope, parent.to_owned(), selection.models.clone());
        if self.route.as_ref() != Some(&route) {
            *self = Self {
                route: Some(route),
                acquisition_scope: self.acquisition_scope,
                ..Self::default()
            };
        }
        if self.retry_after.is_some_and(|until| now < until) {
            return None;
        }
        self.failure = None;
        selection
            .models
            .iter()
            .take(MAX_AUXILIARY_CANDIDATES)
            .enumerate()
            .find(|(index, _)| self.rejected_candidates & (1 << index) == 0)
            .map(|(_, model)| model.clone())
    }

    pub(super) fn reject_candidate(&mut self, model: &str) {
        if let Some((_, _, models)) = &self.route {
            if let Some(index) = models
                .iter()
                .take(MAX_AUXILIARY_CANDIDATES)
                .position(|candidate| candidate == model)
            {
                self.rejected_candidates |= 1 << index;
            }
        }
    }

    pub(crate) fn succeeded(&mut self) {
        self.failure = None;
        self.retry_after = None;
        self.last_warning = None;
    }

    pub(super) fn failed(&mut self, failure: ExtractionFailure, now: Instant) {
        self.failure = Some(failure);
        self.retry_after = match failure {
            ExtractionFailure::UnsupportedModel | ExtractionFailure::Authentication => {
                Some(now + FAILURE_COOLDOWN)
            }
            ExtractionFailure::Other => None,
        };
    }

    pub fn take_warning(&mut self, now: Instant) -> Option<&'static str> {
        let failure = self.failure.unwrap_or(ExtractionFailure::Other);
        if failure == ExtractionFailure::UnsupportedModel {
            return None;
        }
        if self.last_warning.is_some_and(|(previous, when)| {
            previous == failure && now.duration_since(when) < FAILURE_COOLDOWN
        }) {
            return None;
        }
        self.last_warning = Some((failure, now));
        Some(failure.warning())
    }
}

impl From<&ProviderError> for ExtractionFailure {
    fn from(error: &ProviderError) -> Self {
        match error {
            ProviderError::ModelNotFound(_) => Self::UnsupportedModel,
            ProviderError::AuthError(_) => Self::Authentication,
            _ => Self::Other,
        }
    }
}

/// Per-session state for session memory.
#[derive(Debug, Clone, Default)]
pub struct SessionMemoryState {
    /// Current SM markdown content (`None` = never extracted).
    pub content: Option<String>,
    /// Durable start-sequence of the last message summarized into SM.
    /// Frame-independent: extraction (bounded durable suffix) and SM-compact
    /// (in-turn tail) each resolve it to an index in their own array.
    pub last_summarized_seq: Option<i64>,
    /// Total context tokens at the time of the last extraction.
    pub tokens_at_last_extraction: Option<usize>,
    /// Tool calls seen since the last extraction.
    pub tool_calls_since_extraction: usize,
    /// Whether the initialization threshold has been met at least once.
    pub initialized: bool,
    /// Guards against concurrent extractions.
    pub extraction_in_progress: bool,
    /// Identifies the extraction allowed to publish into this runtime.
    pub(crate) extraction_generation: u64,
    /// Transient model rejection/cooldown state; never persisted as memory.
    pub auxiliary_retry: AuxiliaryRetryState,
}

impl SessionMemoryState {
    /// A compacted frame needs a fresh observed-context baseline. Invalidate
    /// any extraction prepared against the previous frame at the same time.
    pub fn reset_after_compaction(&mut self) {
        self.last_summarized_seq = None;
        self.tokens_at_last_extraction = None;
        self.extraction_generation += 1;
        self.extraction_in_progress = false;
    }

    /// Record that tool calls happened (increment counter).
    pub fn record_tool_calls(&mut self, count: usize) {
        self.tool_calls_since_extraction += count;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selection(scope: u64) -> AuxiliaryModel {
        AuxiliaryModel {
            models: vec!["fast".into(), "cheap-backup".into()],
            scope,
        }
    }

    #[test]
    fn auxiliary_rejection_survives_success_and_is_isolated_by_route() {
        let now = Instant::now();
        let mut retry = AuxiliaryRetryState::default();
        assert_eq!(
            retry.select(selection(1), "parent", now).as_deref(),
            Some("fast")
        );
        retry.reject_candidate("fast");
        retry.succeeded();
        assert_eq!(
            retry.select(selection(1), "parent", now).as_deref(),
            Some("cheap-backup")
        );
        assert_eq!(
            retry.select(selection(2), "parent", now).as_deref(),
            Some("fast")
        );
        retry.reject_candidate("fast");
        assert_eq!(
            retry.select(selection(2), "new-parent", now).as_deref(),
            Some("fast")
        );
        let other_session = AuxiliaryRetryState::default();
        assert!(other_session.route.is_none());
    }

    #[test]
    fn auxiliary_exhaustion_stays_silent_after_cooldown_and_never_uses_parent() {
        let now = Instant::now();
        let mut retry = AuxiliaryRetryState::default();
        let selection = AuxiliaryModel {
            models: vec![
                "one".into(),
                "two".into(),
                "three".into(),
                "not-eligible-fourth".into(),
            ],
            scope: 1,
        };
        for model in ["one", "two", "three"] {
            assert_eq!(
                retry
                    .select(selection.clone(), "expensive-parent", now)
                    .as_deref(),
                Some(model)
            );
            retry.reject_candidate(model);
        }
        retry.failed(ExtractionFailure::UnsupportedModel, now);
        assert!(retry.take_warning(now).is_none());
        assert!(retry
            .select(
                selection.clone(),
                "expensive-parent",
                now + FAILURE_COOLDOWN
            )
            .is_none());
        retry.succeeded();
        assert!(retry
            .select(selection, "expensive-parent", now + FAILURE_COOLDOWN)
            .is_none());
    }

    #[test]
    fn auxiliary_cooldown_expires_without_timer_and_switch_bypasses_it() {
        let now = Instant::now();
        let mut retry = AuxiliaryRetryState::default();
        retry.select(selection(1), "parent", now);
        retry.failed(ExtractionFailure::UnsupportedModel, now);
        assert!(retry.is_cooling_down(&selection(1), "parent", now));
        assert!(retry.select(selection(1), "parent", now).is_none());
        assert!(!retry.is_cooling_down(&selection(2), "parent", now));
        assert!(retry
            .select(selection(1), "parent", now + FAILURE_COOLDOWN)
            .is_some());
        retry.failed(ExtractionFailure::Authentication, now + FAILURE_COOLDOWN);
        assert!(retry
            .select(selection(2), "parent", now + FAILURE_COOLDOWN)
            .is_some());
    }

    #[test]
    fn auxiliary_warning_deduplication_resets_after_recovery() {
        let now = Instant::now();
        let mut retry = AuxiliaryRetryState::default();
        retry.failed(ExtractionFailure::Other, now);
        assert!(retry.take_warning(now).is_some());
        assert!(retry.take_warning(now + Duration::from_secs(1)).is_none());
        retry.failed(ExtractionFailure::Authentication, now);
        assert!(retry.take_warning(now).unwrap().contains("authenticate"));
        assert!(retry.take_warning(now + FAILURE_COOLDOWN).is_some());
        retry.succeeded();
        retry.failed(ExtractionFailure::Authentication, now + FAILURE_COOLDOWN);
        assert!(retry.take_warning(now + FAILURE_COOLDOWN).is_some());
    }

    #[test]
    fn auxiliary_acquisition_auth_cooldown_expires_and_route_switch_resets_it() {
        let now = Instant::now();
        let mut retry = AuxiliaryRetryState::default();
        let error = ProviderError::AuthError("fixture".into());
        assert!(retry.begin_attempt(1, now));
        retry.provider_failed(&error, now);
        assert!(!retry.begin_attempt(1, now + FAILURE_COOLDOWN - Duration::from_secs(1)));
        assert!(retry.take_warning(now).unwrap().contains("authenticate"));
        assert!(retry.begin_attempt(1, now + FAILURE_COOLDOWN));
        retry.provider_failed(&error, now + FAILURE_COOLDOWN);
        assert!(retry.begin_attempt(2, now + FAILURE_COOLDOWN));
        retry.select(selection(2), "parent", now + FAILURE_COOLDOWN);
        retry.provider_failed(&error, now + FAILURE_COOLDOWN);
        assert!(
            !retry.begin_attempt(2, now + FAILURE_COOLDOWN),
            "selection must retain acquisition scope"
        );
        retry.succeeded();
        assert!(retry.begin_attempt(2, now + FAILURE_COOLDOWN));
    }
}
