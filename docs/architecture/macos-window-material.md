# macOS window material

ORG2 uses AppKit's `NSVisualEffectView` with the `Menu` material and
`BehindWindow` blending beneath its transparent WKWebView. This is the native
material configured by Codex's normal macOS window. Existing ORG2 sidebar,
page-opacity, solid-background, and theme settings still control the web
surfaces above it; this change does not copy Codex's CSS or its size-based
opaque-window policy.

## Compatibility

The material uses the same implementation across supported macOS versions.
`NSVisualEffectView` is available from macOS 10.10 and `Menu` from 10.11, before
ORG2's 10.15 deployment minimum. Apple Silicon starts at macOS 11. No macOS 26
class lookup, private material variant, or undocumented native corner-radius
selector is used. AppKit owns the decorated window's outer clipping.

| macOS                               | Native implementation | Validation scope                                                              |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| 10.15 Catalina (Intel)              | Public menu vibrancy  | SDK API availability                                                          |
| 11 Big Sur / 12 Monterey            | Public menu vibrancy  | SDK API availability, Intel and Apple Silicon                                 |
| 13 Ventura / 14 Sonoma / 15 Sequoia | Public menu vibrancy  | SDK API availability, Intel and Apple Silicon                                 |
| 26 Tahoe                            | Public menu vibrancy  | SDK API availability, Intel and Apple Silicon; development host is 26.3 arm64 |

An SDK availability check proves the selected APIs are declared for those
deployment targets, not that the application was run on each OS. The material's
colors and blur can vary with macOS, light/dark appearance, focus, and system
accessibility settings. Allow AppKit to manage them instead of reproducing the
material in CSS or forcing a private variant.

The transparent WKWebView still relies on the existing `macOSPrivateApi`
configuration. Removing the Liquid Glass plugin does not remove that separate
requirement or raise the deployment minimum.

## Ownership and lifecycle

`app_window::macos_material` performs each lookup and mutation synchronously on
AppKit's main thread. A native window pointer never crosses the dispatch
boundary. The window's content view retains its material subview, identified by
`org2.window.menu-vibrancy`.

- Enable creates one view if absent; repeated enable leaves the same view in
  place. No global registry or per-window retained handle is needed.
- Disable removes only the identified view; repeated disable does nothing.
- The material resizes with its parent and follows the window's active state
  through native AppKit properties. No polling or app-owned observers are added.
- Destroying the content view releases the material with the rest of its native
  subviews.

Initial main-window setup, main-window recovery, and detached session and
station windows continue to call the same apply helper. The startup opaque cover remains until
the frontend is ready.

## Live resize surfaces

WebKit on macOS 14+ composites web content in the UI process. A window resize
reaches the WKWebView immediately, but the new size is sent to the WebContent
process without a CoreAnimation fence, so the page is repainted at that size one
or more frames later. Until then, the strip at the trailing edges shows the native
views under the transparent webview. From bottom to top, all inside the content
view:

1. **Material** (`org2.window.menu-vibrancy`): the Menu `NSVisualEffectView`.
2. **Root tint** (`org2.window.root-tint`): the composite of the translucent
   `html` / `body` / `#root` tints, mirrored by `src/util/platform/macosRootTint.ts`
   so the CSS tints can go transparent.
3. **Page backdrop** (`org2.window.page-backdrop`): an opaque layer in the page
   colour, under the page surface's region. `src/util/platform/macosPageBackdrop.ts`
   measures the registered page surface (`useMacosPageBackdropSurface`: its insets
   from the viewport edges and its colour) and sends it through
   `set_window_page_backdrop`; only opaque surfaces are mirrored.

The page backdrop is hidden except while the window resizes.
`NSWindowWillStartLiveResizeNotification` and `NSWindowDidResizeNotification`
reveal it synchronously, in the same CoreAnimation transaction as the new frame.
It hides again after 500 ms without a resize, and stays revealed while a live resize
is still tracking. Tauri's `WindowEvent::Resized` is not used for the reveal: tao
drains its event queue after CoreAnimation's commit, so a reveal from it reaches
the screen one frame late. The layer cannot stay visible either. Sidebar geometry
reaches native a frame or two after the page repaints, so a visible layer would sit
under the translucent sidebar while it grows. Implicit layer animations are
disabled so the reveal does not fade in.

Measured in a standalone AppKit + WKWebView harness on macOS 26 with this stack
(programmatic 10 pt growth steps over a text-heavy page, capturing the window after
each step):

| Configuration                                   | Trailing strip in page colour | Growing-sidebar artifacts             |
| ----------------------------------------------- | ----------------------------- | ------------------------------------- |
| Material + root tint only (before)              | 18% of samples                | n/a                                   |
| Page backdrop always visible                    | 100%                          | up to 54 pt band (16–33 ms IPC delay) |
| Page backdrop revealed from resize notification | 100%, first step included     | none                                  |

## Dependency choice

The implementation uses the workspace's existing `objc2`, `objc2-app-kit`,
`objc2-foundation`, and `dispatch2` dependencies directly. No dependency is added
or upgraded. Removing `tauri-plugin-liquid-glass` also removes its otherwise
unused `cocoa`, `cocoa-foundation`, `block`, `objc`, `dispatch`, and `malloc_buf`
dependency chain.

The pinned Tauri 2.10.3 `set_effects(None)` path does not clear macOS effects.
Its apply path can create additional native views on repeated calls. Direct
native ownership avoids that issue. The existing window-vibrancy 0.6 helper also
calls an undocumented `NSVisualEffectView.setCornerRadius:` selector even when
no radius is supplied; it is not used for this macOS implementation. Windows
continues to use its existing window-vibrancy helper unchanged.

## Release verification

The final PR records commands actually run. Native visual and lifecycle checks
remain necessary on representative older and current macOS releases:

- Light and dark themes, bright/dark desktop backgrounds, and Reduce
  Transparency enabled/disabled.
- Cold startup and frontend-ready transition, main-window recovery, and
  detached session / station window creation/close.
- Repeated enable/disable, proving the content view has zero or one owned
  material view and unrelated subviews remain intact.
- Focus changes, minimize/restore, resize/fullscreen, and Retina/external-display
  changes.
- Dragging each window edge and corner, zoom (double-click title bar, green button),
  and window tiling. The trailing strip should show the page colour beside the page
  and the translucent root surface under the sidebar, and the sidebar should never
  turn opaque while it expands or is dragged.
- Visible/hidden idle and active CPU/GPU behavior; source shape alone is not
  performance evidence.

Rollback is a revert of the material implementation and manifest/lockfile
removals. No persisted settings, schemas, or user data require migration.
