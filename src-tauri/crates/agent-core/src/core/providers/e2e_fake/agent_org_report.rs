//! Provider timing only; rendered Stop and Retry retain all production owners.
use super::*;

pub(super) async fn wait_window(
    messages: &[Value],
    on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
    cancel_flag: Option<&AtomicBool>,
) -> Result<(), ProviderError> {
    if !messages.iter().any(|message| {
        message["role"] == "system"
            && content_text(&message["content"]).is_some_and(|text| {
                text.starts_with("You write one final user-facing Agent Org report")
            })
    }) {
        return Ok(());
    }
    let texts = messages
        .iter()
        .filter_map(|m| content_text(&m["content"]))
        .collect::<Vec<_>>();
    let stream = texts
        .iter()
        .any(|text| text.contains("summary_stop_stream_"));
    if !stream
        && !texts
            .iter()
            .any(|text| text.contains("summary_stop_before_"))
    {
        return Ok(());
    }
    for _ in 0..60 {
        if cancel_flag.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::Relaxed)) {
            return Err(ProviderError::Cancelled);
        }
        if stream {
            on_delta(StreamDelta {
                content: Some("REPORT_STREAM_STARTED ".into()),
                reasoning: None,
                tool_call_delta: None,
                finish_reason: None,
                usage: None,
            });
        }
        sleep(Duration::from_millis(500)).await;
    }
    Ok(())
}
