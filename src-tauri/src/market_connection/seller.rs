//! App-initiated provider authorization, owned by the canonical Cloud identity.
#[cfg(feature = "market-connect")]
mod enabled {
    use super::super::owner::{self, Lease};
    use market_connect::{
        SellerBinding, SellerConnection, SellerEnrollment, SellerProof, SellerSelection,
    };
    use std::sync::{Mutex, OnceLock};
    use tauri_plugin_opener::OpenerExt;
    use tokio::sync::watch;

    // Only literal stage names and allowlisted codes enter diagnostics.
    fn diagnostic_code(error: &str) -> &'static str {
        match error {
            "seller_exchange_failed" => "seller_exchange_failed",
            "invalid_seller_grant" => "invalid_seller_grant",
            "seller_transport_unavailable" => "seller_transport_unavailable",
            "seller_operation_uncertain" => "seller_operation_uncertain",
            "seller_operation_failed" => "seller_operation_failed",
            "seller_connection_expired" => "seller_connection_expired",
            "invalid_seller_start" => "invalid_seller_start",
            "invalid_seller_authorization" => "invalid_seller_authorization",
            "seller_authorization_expired" => "seller_authorization_expired",
            "seller_callback_unavailable" => "seller_callback_unavailable",
            "invalid_seller_cancel" => "invalid_seller_cancel",
            "market_identity_changed" => "market_identity_changed",
            "seller_connection_cancelled" => "seller_connection_cancelled",
            "seller_operation_http_400" => "seller_operation_http_400",
            "seller_operation_http_401" => "seller_operation_http_401",
            "seller_operation_http_403" => "seller_operation_http_403",
            "seller_operation_http_404" => "seller_operation_http_404",
            "seller_operation_http_409" => "seller_operation_http_409",
            "seller_operation_http_429" => "seller_operation_http_429",
            "seller_operation_http_500" => "seller_operation_http_500",
            "seller_operation_http_502" => "seller_operation_http_502",
            "seller_operation_http_503" => "seller_operation_http_503",
            "seller_operation_http_504" => "seller_operation_http_504",
            _ => "seller_request_failed",
        }
    }
    fn failure(stage: &'static str, error: &str) {
        tracing::warn!(
            stage,
            code = diagnostic_code(error),
            "Market seller operation failed"
        );
    }

    #[derive(Default)]
    struct State {
        enrollment: SellerEnrollment,
        lease: Option<Lease>,
        cancel: Option<watch::Sender<bool>>,
    }
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    fn state() -> &'static Mutex<State> {
        STATE.get_or_init(Default::default)
    }
    struct AttemptGuard(String);
    impl Drop for AttemptGuard {
        fn drop(&mut self) {
            if let Ok(mut state) = state().lock() {
                state.enrollment.finish(&self.0);
                state.cancel = None;
                state.lease = None;
            }
        }
    }
    pub fn begin(provider: String, region: String) -> Result<SellerProof, String> {
        let lease = owner::require()?;
        let mut state = state()
            .lock()
            .map_err(|_| "seller_connection_unavailable")?;
        if state.cancel.is_some() {
            return Err("seller_connection_in_progress".into());
        }
        // A logout/account switch retires an abandoned pre-authorization proof.
        if state.lease.as_ref().is_some_and(|old| old.check().is_err()) {
            state.enrollment.cancel();
        }
        let proof = state
            .enrollment
            .begin(SellerSelection { provider, region })?;
        state.lease = Some(lease);
        Ok(proof)
    }
    pub fn cancel() -> Result<(), String> {
        let mut state = state()
            .lock()
            .map_err(|_| "seller_connection_unavailable")?;
        if let Some(cancel) = &state.cancel {
            let _ = cancel.send(true);
        } else {
            state.enrollment.cancel();
            state.lease = None;
        }
        Ok(())
    }
    async fn connect(
        grant: &SellerConnection,
        app: &tauri::AppHandle,
        lease: &Lease,
        mut cancelled: watch::Receiver<bool>,
        mut changed: watch::Receiver<u64>,
    ) -> Result<SellerBinding, String> {
        let check = || -> Result<(), String> {
            lease.matches(grant.identity_user_id())?;
            if *cancelled.borrow() {
                return Err("seller_connection_cancelled".into());
            }
            Ok(())
        };
        check()?;
        tracing::info!(stage = "provider_start", "Market seller operation started");
        let started = std::time::Instant::now();
        let authorization = grant.start().await.inspect_err(|error| {
            tracing::warn!(
                stage = "provider_start",
                elapsed_ms = started.elapsed().as_millis() as u64,
                "Market seller operation duration"
            );
            failure("provider_start_or_validation", error);
        })?;
        tracing::info!(
            stage = "provider_authorization_validated",
            elapsed_ms = started.elapsed().as_millis() as u64,
            "Market seller operation succeeded"
        );
        check()?;
        let url = authorization.browser_url().to_owned();
        let receiver = authorization.listen().await.inspect_err(|error| {
            failure("callback_listen", error);
        })?;
        tracing::info!(
            stage = "callback_listening",
            "Market seller operation succeeded"
        );
        check()?;
        app.opener().open_url(url, None::<&str>).map_err(|_| {
            tracing::warn!(
                stage = "browser_open",
                code = "seller_browser_open_failed",
                "Market seller operation failed"
            );
            "seller_browser_open_failed"
        })?;
        tracing::info!(stage = "browser_open", "Market seller operation succeeded");
        let callback = tokio::select! {
            biased;
            _=cancelled.changed()=>return Err("seller_connection_cancelled".into()),
            _=changed.changed()=>return Err("market_identity_changed".into()),
            result=receiver.receive()=>result?,
        };
        lease.matches(grant.identity_user_id())?;
        if *cancelled.borrow() {
            return Err("seller_connection_cancelled".into());
        }
        // Once committed, reconcile the authoritative result rather than replaying a code.
        grant.complete(&callback).await.map_err(String::from)
    }
    pub async fn complete(
        code: String,
        proof_state: String,
        expected_identity_user_id: String,
        app: tauri::AppHandle,
    ) -> Result<serde_json::Value, String> {
        let changed = owner::subscribe_changes();
        let (redemption, lease, cancelled) = {
            let mut state = state()
                .lock()
                .map_err(|_| "seller_connection_unavailable")?;
            if state.cancel.is_some() {
                return Err("seller_connection_in_progress".into());
            }
            let lease = state
                .lease
                .as_ref()
                .ok_or("no_pending_seller_connection")?
                .clone();
            lease.matches(&expected_identity_user_id)?;
            let redemption = state.enrollment.take_redemption(&code, &proof_state)?;
            let (sender, receiver) = watch::channel(false);
            state.cancel = Some(sender);
            (redemption, lease, receiver)
        };
        let guard = AttemptGuard(redemption.attempt_id().to_owned());
        tokio::spawn(async move {
            let _guard = guard;
            let grant = redemption.exchange().await.map_err(|error| {
                failure("grant_exchange", error);
                String::from(error)
            })?;
            tracing::info!(
                stage = "grant_exchange",
                "Market seller operation succeeded"
            );
            let result = connect(&grant, &app, &lease, cancelled, changed).await;
            if result.is_err() {
                let cancel_started = std::time::Instant::now();
                match grant.cancel().await {
                    Ok(()) => tracing::info!(stage = "cancel", "Market seller operation succeeded"),
                    Err(error) => failure("cancel", error),
                }
                tracing::info!(
                    stage = "cancel",
                    elapsed_ms = cancel_started.elapsed().as_millis() as u64,
                    "Market seller operation duration"
                );
            }
            let binding = result?;
            lease.matches(grant.identity_user_id())?;
            serde_json::to_value(binding).map_err(|_| "invalid_seller_binding".into())
        })
        .await
        .map_err(|_| "seller_connection_unavailable".to_owned())?
    }
}
#[tauri::command]
pub async fn market_seller_begin(
    provider: String,
    region: String,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "market-connect")]
    {
        serde_json::to_value(enabled::begin(provider, region)?)
            .map_err(|_| "seller_connection_unavailable".into())
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (provider, region);
        Err("market_module_disabled".into())
    }
}
#[tauri::command]
pub async fn market_seller_complete(
    code: String,
    state: String,
    expected_identity_user_id: String,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "market-connect")]
    {
        enabled::complete(code, state, expected_identity_user_id, app).await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (code, state, expected_identity_user_id, app);
        Err("market_module_disabled".into())
    }
}
#[tauri::command]
pub async fn market_seller_cancel() -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    {
        enabled::cancel()
    }
    #[cfg(not(feature = "market-connect"))]
    {
        Ok(())
    }
}
