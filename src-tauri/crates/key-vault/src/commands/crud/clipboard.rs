/// Write text to the system clipboard via arboard.
/// Used by the frontend when `navigator.clipboard.writeText` fails (e.g.
/// after an async RPC call where the user-gesture token has expired).
#[tauri::command]
pub async fn clipboard_write_text(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|err| format!("Clipboard access failed: {}", err))?;
        clipboard
            .set_text(&text)
            .map_err(|err| format!("Clipboard write failed: {}", err))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

fn validate_image(rgba: &[u8], width: usize, height: usize) -> Result<(), String> {
    let pixels = width
        .checked_mul(height)
        .ok_or("Invalid image dimensions")?;
    if pixels == 0 || pixels > 16_777_216 || pixels.checked_mul(4) != Some(rgba.len()) {
        return Err("Invalid RGBA image payload".into());
    }
    Ok(())
}

/// Like text copy, native-menu callbacks cannot use WebKit's gesture-gated API.
/// Kept with the existing clipboard façade; performs OS work off the UI thread.
#[tauri::command]
pub async fn clipboard_write_image(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let dimension = |name: &str| -> Result<usize, String> {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
            .ok_or_else(|| "Invalid image dimensions".into())
    };
    let width = dimension("x-image-width")?;
    let height = dimension("x-image-height")?;
    let tauri::ipc::InvokeBody::Raw(rgba) = request.body() else {
        return Err("Expected binary RGBA image payload".into());
    };
    validate_image(rgba, width, height)?;
    let rgba = rgba.clone();
    tokio::task::spawn_blocking(move || {
        let mut clipboard = arboard::Clipboard::new().map_err(|err| err.to_string())?;
        clipboard
            .set_image(arboard::ImageData {
                width,
                height,
                bytes: std::borrow::Cow::Owned(rgba),
            })
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::validate_image;

    #[test]
    fn validates_rgba_payload_before_clipboard_access() {
        assert!(validate_image(&[0, 1, 2, 255], 1, 1).is_ok());
        assert!(validate_image(&[], 0, 1).is_err());
        assert!(validate_image(&[0; 3], 1, 1).is_err());
        assert!(validate_image(&[], usize::MAX, 2).is_err());
        assert!(validate_image(&[], 16_777_217, 1).is_err());
    }
}
