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
        let authorization = grant.start().await?;
        check()?;
        let url = authorization.browser_url().to_owned();
        let receiver = authorization.listen().await?;
        check()?;
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|_| "seller_browser_open_failed")?;
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
            let grant = redemption.exchange().await.map_err(String::from)?;
            let result = connect(&grant, &app, &lease, cancelled, changed).await;
            if result.is_err() {
                let _ = grant.cancel().await;
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
