# Luna Reserve: why Luna calls failed and how to use the reserve — 2026-09-17

Source of truth: openai/codex at `fa8cf44` (cloned read-only).

- `codex-rs/tui/src/model_catalog.rs`: `LUNA_RESERVE_MODEL = "gpt-reserve"`. When
  ordinary usage is exhausted the official client rewrites the pending turn's
  model to this slug (`chatwidget/luna_reserve_model.rs`,
  `apply_reserve_fallback_to_pending_turn`).
- `codex-rs/backend-client/src/client/rate_limit_resets.rs`: the header
  `x-openai-codex-luna-reserve: 1` is sent only on the rate-limit status GET so
  the backend records exposure; the payload carries `ordinary_usage_allowed`.
- The reserve meter is reported as limit id `base_model_inference`, limit name
  `gpt-reserve`, `normal_model_slug: gpt-5.6-luna`, and in response headers as
  `X-Base-Model-Inference-*`.

Same account, same minute (local acceptance Market, exact-account diagnostic,
no Market state change):

| request model | upstream | headers | result |
|---|---|---|---|
| `gpt-5.6-luna` | 429 `usage_limit_reached` | `X-Codex-Primary-Used-Percent: 100`, `X-Base-Model-Inference-Primary-Used-Percent: 14` | rejected |
| `gpt-reserve` | 200 | same meters | `response.model = gpt-5.6-luna`, output `LUNA-RESERVE-OK`, 36 in / 11 out tokens |

Reports: `/tmp/market-luna-ordinary-recheck-20260917/report.json`,
`/tmp/market-luna-reserve-once-20260917/report.json`.

Consequence for the Market (cloud-infra, harness-plane Codex adapter): a Luna
request that hits `usage_limit_reached` with limit name `codex` must be retried
once with `model: "gpt-reserve"` when the account's `base_model_inference`
meter has room; the response still reports `gpt-5.6-luna`, so pricing and
receipts stay on the Luna price card. Until that lands, Codex/Luna Package
calls on an exhausted account fail even though the reserve is available.

## Decisive reserve-bucket proof — 2026-09-18 00:21:36Z

An adversarial review of the earlier evidence found a real hole: the first
successful `gpt-reserve` call (2026-09-17T21:33:16Z) reported
`X-Codex-Primary-Used-Percent: 14`, so "the ordinary bucket had simply
recovered" was not excluded, and that header alone never proved reserve
routing. The distinguishing test is to call `gpt-reserve` while the ordinary
window is *known* to be exhausted on the same account.

Read the account's persisted telemetry immediately before the probe
(`market.capacity_registry`, auth `codex-vinceorz418-gmail-com`):

| window | utilization | resets |
|---|---|---|
| `codex:primary` | 1.0 (exhausted) | 2026-09-19T08:23:02Z |
| `codex:reserve:gpt-5.6-luna:primary` | 0.14 | 2026-09-23T23:36:42Z |

Independent corroboration that the ordinary window was really out at that
moment: every `gpt-5.6-luna` call through the Package between 23:17Z and
23:57Z came back `429 usage_limit_reached` with
`X-Codex-Primary-Used-Percent: 100`.

The probe (same exact-account CPA management `api-call` path as before, one
call, no Market writes — `business_unchanged: true`):

```
started_at        2026-09-18T00:21:36.927Z
request model     gpt-reserve
upstream_status   200
response model    gpt-5.6-luna
output_text       LUNA-RESERVE-OK
headers           X-Base-Model-Inference-Limit-Name: gpt-reserve
                  X-Base-Model-Inference-Primary-Used-Percent: 14
                  X-Codex-Primary-Used-Percent: 14
```

**Conclusion.** The reserve is a genuinely separate quota bucket: it served a
completed Luna answer while the ordinary weekly window was at 100 %. It also
explains the header confusion — on a `gpt-reserve` request the
`X-Codex-Primary-Used-Percent` family reports the RESERVE bucket (14 %), not
the ordinary one, which is why the 21:33Z call looked like a recovered
ordinary window. Cloud PR #117's premise holds; what is missing is only the
adapter's willingness to route the slug.

Report: `/private/tmp/claude-501/-Users-vinceorz-Projects-ORGII-cloud-infra/6f598f8d-6e97-4c58-a2db-a180af451dfe/scratchpad/luna-reserve-decisive/report.json`.
