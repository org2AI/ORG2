# CodeMirror diff presentation

Unified, split and regular editors use far-left change rails and continuous gutter fills. Changed numbers and code rows use existing diff color tokens. Regular-editor deletion anchors do not paint surviving code as deleted. Collapsed unchanged regions use rounded ends, 8px side insets and identically inset gutter/content backgrounds. Stacked arrows have a 2px gap and independent hover fills; label hover fills both halves. Arrows reveal 20 lines from their side; the label expands all. Split panes stay synchronized.

| Area               | Verdict | Evidence                                                              | Change or reason kept                                                                      | Verification                                       |
| ------------------ | ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Background work    | keep    | Four delegated mouse/focus listeners per editor, no new timer         | Plugin removes listeners on destruction                                                    | Post-destroy event test                            |
| Memory             | keep    | No global cache or retained DOM-node collection                       | Number markers render on demand; row decorations derive from existing dirty markers        | 10,000-line fixture formats fewer than 200 numbers |
| Scope/isolation    | keep    | Collapse positions and merge side come from each editor               | Events outside the editor clear hover; chunk offsets map incremental expansion to the peer | Split and matching-row tests                       |
| Rendering/hot path | keep    | Binary search per visible diff number; no geometry reads during hover | Native widget lifecycle owns gutter elements                                               | Gutter/row DOM assertions                          |

An isolated headless Chromium fixture bundled the actual shared theme, collapse theme, gutter/number extensions and compiled diff stylesheet. Leading and trailing pills measured 26px on both sides; the middle stacked pill measured 40px on both sides. Their vertical origins matched exactly. The browser also verified a 2px control gap, one-half hover and label-hover behavior. The resulting screenshot was visually inspected: [browser fixture](DiffRows.png).

This evidence covers the isolated light-theme browser fixture, not the live Tauri app, dark theme or narrow viewport. No runtime speed improvement is claimed. Performance verdict: blocked for desktop CPU/RSS and hidden/idle lifecycle measurements; source ownership and targeted lifecycle assertions pass.

The label pseudo-element overrides the merge theme’s decorative margin. A headless browser measured the horizontal divider shrinking from 9px to 2px, matching the 2px gap between stacked arrow controls. The screenshot reflects this correction.

Incremental remainder decorations belong to editor state and are bounded by partially opened blocks. Transactions map them through edits and remove ranges containing newly changed text, including peer edits. No timers, global caches or additional listeners are introduced. Four regression tests cover repeated expansion, full expansion, unequal split offsets, and local/peer edits. The browser verified 33 → 23 → 13 hidden lines and matching 40px backgrounds after expansion. The replacement widget supplies the native height estimate so CodeMirror measures its gutter correctly.

The expansion step now matches [GitHub Desktop’s default of 20](https://github.com/desktop/desktop/blob/development/app/src/ui/diff/text-diff-expansion.ts). Regression fixtures cover 73 → 53 → 33 → 13 → fully expanded, plus file-boundary clamping. Earlier browser measurements above used the previous 10-line step; geometry code is unchanged.
