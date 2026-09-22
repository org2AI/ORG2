# Mobile turn identity follow-up

| Line                     | Element                   | Verdict          | Reason                                                                                                             | Suggested change                                         |
| ------------------------ | ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `MobileTurnBody.tsx:91`  | Prompt and body rendering | fix              | Switching from bare rows to a wrapped body remounted still-visible messages when a round completed or busy changed | Keep the same parent slots and keyed rows in every state |
| `MobileTurnBody.tsx:97`  | Disclosure control        | keep with reason | Existing shared Button owns keyboard/ARIA behavior; custom layout aligns label and chevron across transcript width | None                                                     |
| `MobileTurnBody.tsx:128` | Collapsed body            | keep with reason | Intentionally excluded work still unmounts; retaining it hidden would keep its image/editor resources alive        | Preserve existing collapse policy                        |

Verdict totals: **1 fix**, **2 keep with reason**, **0 abstract**.

## Lifecycle and ownership

`ChatTranscript` owns the selected items and scopes `MobileTurnBody` by authenticated
image scope, session and round. `MobileTurnBody` owns only the local expansion
preference. Incoming round status and `busy` choose disclosure availability, not
React parent identity. No persisted domain data or writer changes are needed.

| Transition                                         | Contract and coverage                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Prompt only → live output → completed              | Loaded prompt/final previews remain the same DOM nodes and are not requested again |
| Completed → busy → completed, repeated three times | Summary toggles availability; continuously visible rows retain state               |
| Pending → failed/cancelled/interrupted             | Expanded tool nodes remain identical                                               |
| Manual expand/collapse                             | Existing hidden-work unmount policy and scroll-follow pause remain unchanged       |
| Empty/user-only/legacy mixed-round input           | No misleading summary; original message order preserved                            |
| Account/endpoint/desktop/session/round switch      | Existing keyed owner clears previews and rejects stale image results               |

## Architecture coverage

Reviewed layers 1–7: compilation, elimination of the alternate render path, naming,
separation of busy/terminal/local-expansion meanings, empty/default branches,
mobile-local ownership and explanatory comments. Layer 9: initial terminal and
live-to-terminal entries now share the same structure. Layers 8 and 10 are not
applicable: no wire format or multi-source resolver changed.

## Performance guard

| Area               | Verdict | Evidence                                              | Change or reason kept                                | Verification                                                             |
| ------------------ | ------- | ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Background work    | keep    | No timer, listener, request or subscription added     | Hidden work still unmounts; existing owners clean up | Existing image stale-result and scroll tests                             |
| Memory             | keep    | One selected round; image retention cap remains eight | No hidden-history cache introduced                   | Eight-preview cap and scope-switch tests                                 |
| Scope/isolation    | keep    | Existing ChatTranscript identity/session/round key    | No expansion/image state crosses scope               | Existing five scope-change cases                                         |
| Rendering/hot path | fix     | Completion formerly replaced parent nodes             | Stable parent and keyed visible children             | DOM identity and image-state regression tests, repeated busy transitions |

Structural lifecycle checks pass. Real-device idle CPU/RSS and visual scroll-height
measurement were not run; performance measurement verdict is **blocked** on that
runtime validation. This patch makes no CPU/RSS improvement claim.

## Verification

- `pnpm test src/modules/MobileRemote/components/transcript/ChatTranscript.test.ts src/modules/MobileRemote/components/transcript/MobileMessageImages.test.ts`: 34 passing tests
- Scoped ESLint (normal and typed), oxlint and `git diff --check`: passed
- Inspected production JSX: existing shared Button retained; no native-button or clickable-element bypass added
- No new tokens or colors; no screenshot because presentation is unchanged. iOS visual behavior and VoiceOver were not exercised in this follow-up
