const COMMANDS: &[&str] = &["is_supported", "start", "stop", "cancel"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
