# TP Agent Studio — Two-tone identity (provisional)

![TP Agent Studio icon](../../assets/branding/tp-agent-studio.svg)

## Palette and metaphor

The fork's native desktop app uses **exactly two brand inks**: Midnight Navy `#101D33` and Electric Cyan `#4DD8F5` (alpha/transparency for shape edges is acceptable). The paired chevrons signify code/tools; the central node symbolizes agent orchestration. Do not reuse or imitate the upstream publisher's original icon or signing identity.

## Source of truth and packaged resources

- `assets/branding/tp-agent-studio.svg`: primary source vector, 512x512 viewBox.
- `assets/branding/tp-agent-studio-dev.svg`: same primary geometry with a small cyan development mark, distinguished by a navy center.
- `src-tauri/icons/{icon.png,icon.icns,icon.ico,32x32.png,64x64.png,128x128.png,128x128@2x.png}`: compiled assets for Windows, Linux and macOS.
- `src-tauri/icons/dev/{icon.png,icon.icns,icon.ico,32x32.png,128x128.png,128x128@2x.png}`: development icon variants.
- `src-tauri/icons/dock/dark.png`: uses the same primary art as the main application icon; this is the default live Dock icon.
- `scripts/fork/check-icons.mjs`: validates image signatures, dimensions, palette, PNG pixel compression, embedded ICO/ICNS images and the Dock invariant.

## Regenerating

SVG is the editable artwork. Rasterize to 8-bit RGBA PNG (not indexed PNG, which Tauri rejects at build time), package the PNG/ICO/ICNS resources, and run `node scripts/fork/check-icons.mjs`. The app's image validation is part of the fork-safety CI workflow. When changing the two color codes or path geometry, update both source SVGs and all bundled binary targets in the same pull request; do not ship the original ORG2 icon accidentally.

## Remaining branding work

- The historical `light` and `rainbow` optional Dock variants still use legacy upstream art; new fork-owned two-tone alternatives and settings migration are required before shipping. The default `dark` variant now uses TP Agent Studio art.
- Tray icon remains a platform-appropriate monochrome template; separately update its glyph before final release.
- Microsoft Store tile logos, mobile icons and UI splash/logo illustrations still need a dedicated rebranding pass.
- Update external URL/callback, cloud identity and public product copy only with ownership/compatibility tests.
- Perform installer, app-switcher and taskbar icon acceptance tests on macOS Apple Silicon, Windows 11 and Linux.

**Safety:** fork updater remains disabled; no independently signed/distributed installers yet. Keep the upstream AGPL-3.0-or-later license and attribution.
