//! Own one bounded seller enrollment task. The webview never receives credentials.
#[cfg(feature = "market-connect")]
mod enabled {
    use market_connect::{SellerBinding, SellerConnection, SellerEnrollment};
    use std::sync::{Mutex, OnceLock};
    use tauri_plugin_opener::OpenerExt;
    use tokio::sync::watch;

    #[derive(Default)]
    struct Owner {
        enrollment: SellerEnrollment,
        cancel: Option<watch::Sender<bool>>,
    }
    static OWNER: OnceLock<Mutex<Owner>> = OnceLock::new();
    fn owner() -> &'static Mutex<Owner> {
        OWNER.get_or_init(Default::default)
    }

    struct AttemptGuard(String);
    impl Drop for AttemptGuard {
        fn drop(&mut self) {
            if let Ok(mut state) = owner().lock() {
                state.enrollment.finish(&self.0);
                state.cancel = None;
            }
        }
    }
    pub fn begin(raw: String) -> Result<String, String> {
        let selection =
            market_connect::parse_seller_selection(&raw).ok_or("invalid_seller_selection")?;
        let mut state = owner()
            .lock()
            .map_err(|_| "seller_connection_unavailable")?;
        if state.cancel.is_some() {
            return Err("seller_connection_in_progress".into());
        }
        state.enrollment.begin(selection).map_err(Into::into)
    }
    pub fn cancel() -> Result<(), String> {
        let mut state = owner()
            .lock()
            .map_err(|_| "seller_connection_unavailable")?;
        if let Some(cancel) = &state.cancel {
            // Keep ownership until the task finishes cleanup. A second flow cannot
            // race the old listener or provisioning operation.
            let _ = cancel.send(true);
        } else {
            state.enrollment.cancel();
        }
        Ok(())
    }
    async fn connect(
        grant: &SellerConnection,
        app: &tauri::AppHandle,
        mut cancelled: watch::Receiver<bool>,
    ) -> Result<SellerBinding, &'static str> {
        if *cancelled.borrow() {
            return Err("seller_connection_cancelled");
        }
        let authorization = grant.start().await?;
        if *cancelled.borrow() {
            return Err("seller_connection_cancelled");
        }
        let url = authorization.browser_url().to_owned();
        let receiver = authorization.listen().await?;
        // Binding succeeds before the browser is opened. The select owns and
        // drops the receiver on cancellation, including its listener task.
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|_| "seller_browser_open_failed")?;
        let callback = tokio::select! {
            biased;
            _ = cancelled.changed() => return Err("seller_connection_cancelled"),
            result = receiver.receive() => result?,
        };
        if *cancelled.borrow() {
            return Err("seller_connection_cancelled");
        }
        // Once committing, read back the authoritative result even if the user
        // closes the dialog. A completed binding must not be reported cancelled.
        grant.complete(&callback).await
    }
    pub async fn complete(raw: String, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
        let (redemption, cancelled) = {
            let mut state = owner()
                .lock()
                .map_err(|_| "seller_connection_unavailable")?;
            if state.cancel.is_some() {
                return Err("seller_connection_in_progress".into());
            }
            let redemption = state.enrollment.take_redemption(&raw)?;
            let (sender, receiver) = watch::channel(false);
            state.cancel = Some(sender);
            (redemption, receiver)
        };
        // Native owns the task even if the initiating webview is destroyed.
        let guard = AttemptGuard(redemption.attempt_id().to_owned());
        tokio::spawn(async move {
            let _guard = guard;
            let result = match redemption.exchange().await {
                Ok(grant) => {
                    let result = connect(&grant, &app, cancelled).await;
                    if result.is_err() {
                        let _ = grant.cancel().await;
                    }
                    result
                }
                Err(error) => Err(error),
            };
            result
                .and_then(|binding| {
                    serde_json::to_value(binding).map_err(|_| "invalid_seller_binding")
                })
                .map_err(String::from)
        })
        .await
        .map_err(|_| "seller_connection_unavailable".to_string())?
    }
}

#[tauri::command]
pub async fn market_seller_begin(raw: String) -> Result<String, String> {
    #[cfg(feature = "market-connect")]
    {
        enabled::begin(raw)
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = raw;
        Err("market_module_disabled".into())
    }
}
#[tauri::command]
pub async fn market_seller_complete(
    raw: String,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "market-connect")]
    {
        enabled::complete(raw, app).await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (raw, app);
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
