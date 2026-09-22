# Managed model services UI audit

| Line | Element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- | --- |
| `src/features/MarketConnect/UsageAuthorizationHost.tsx:64` | Usage authorization | keep with reason | Uses shared Modal, Button, Input and Checkbox with explicit cancel/confirmation | None at source level; rendered states remain untested |
| `src/modules/MainApp/Settings/sections/HarnessConnections/AppConnectionPage.tsx:228` | App status and restore | keep with reason | Reuses SectionContainer, shared actions and existing conflict/restore flow | Verify focus, loading and error states during Computer Use |
| `src/modules/MainApp/Settings/sections/HarnessConnections/AppConnectionPage.tsx:414` | Per-app model choice | keep with reason | Shared Select and Button; applies only to the selected target | Verify narrow viewport and keyboard selection |
| `src/features/MarketConnect/UsageAuthorizationHost.tsx:90` | All-rate disclosure | keep with reason | Native details/summary is a semantic disclosure; it is not a replacement action button | Verify readability with a real server response |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Source inspection only. Raw React action/form controls were not introduced in these new surfaces. Visual, accessibility, theme and runtime verification were deferred at the user's explicit request; this is not a UI acceptance result.
