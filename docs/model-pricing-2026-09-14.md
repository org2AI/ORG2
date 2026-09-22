# Model pricing verification — 2026-09-14

The bundled rate card supplies **reference estimates**, not invoice totals.
Explicitly identified Cursor Fast variants use their own rates. This
change corrects missing or stale prices at their source,
`src-tauri/crates/orgtrack-core/src/model_pricing_catalog.json`. The lookup feeds
session usage projections, request-log costs, and the dashboard's price tooltip.
All amounts below are USD per million text tokens.

## Verified corrections

| Model                                                | Input | Output | Cache write | Cache read | Correction                                                 |
| ---------------------------------------------------- | ----: | -----: | ----------: | ---------: | ---------------------------------------------------------- |
| GPT-6 Astra                                          |    10 |     50 |        12.5 |          1 | Missing entry used the 3/15/3.75/0.3 default               |
| GPT-5.6 Sol; GPT-5.6 alias                           |     4 |     20 |           5 |        0.4 | Stale prices; alias previously fell back to GPT-5          |
| GPT-5.6 Terra                                        |     2 |     12 |         2.5 |        0.2 | Stale prices                                               |
| GPT-5.6 Luna                                         |   0.2 |    1.2 |        0.25 |       0.02 | Stale prices                                               |
| GPT-5.5 Pro                                          |    30 |    180 |          30 |         30 | Remove unsupported cache-read discount                     |
| Claude Mythos 5.1                                    |    10 |     50 |        12.5 |       0.25 | Missing entry inherited Mythos 5's higher cache-read price |
| Gemini 2.5 Pro                                       |  1.25 |     10 |        1.25 |      0.125 | Cache read was 0.31                                        |
| Gemini 2.5 Flash; generic Gemini Flash reference     |   0.3 |    2.5 |         0.3 |       0.03 | Cache read was 0.075                                       |
| Gemini 2.5 Flash-Lite                                |   0.1 |    0.4 |         0.1 |       0.01 | Cache read was 0.025                                       |
| Gemini 3.5 Flash                                     |   1.5 |      9 |         1.5 |       0.15 | Cache read was 0.375                                       |
| MiniMax M3; generic MiniMax reference                |   0.3 |    1.2 |         0.3 |       0.06 | Permanent discount was absent                              |
| DeepSeek V4 Pro                                      |  1.32 |   3.96 |        1.32 |      0.044 | Obsolete prices                                            |
| DeepSeek Flash; V4 Flash; generic DeepSeek reference |   0.3 |    1.2 |         0.3 |      0.006 | Current Flash name missing; obsolete prices                |

Sources opened on the verification date:

- [OpenAI pricing](https://developers.openai.com/api/docs/pricing): standard,
  short-context rates. Its explicit cache-write column is the rate authority;
  individual model comparison cards can omit that column.
- [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol): the
  unsuffixed GPT-5.6 alias points to Sol.
- [GPT-5.5 Pro](https://developers.openai.com/api/docs/models/gpt-5.5-pro): no
  cached-input discount. The catalog represents unsupported cache discounts at
  the ordinary input rate, consistently with other Pro entries.
- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) and
  [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview): Fable
  5.1 was already correct at 10/50/12.5/0.25; Mythos 5.1 shares its rates. Fable
  and Mythos 5 retain their distinct cache price. Sonnet 5's 2/10 rate is now
  permanent; remove the cancelled September increase from the catalog comment.
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing): standard text
  prices, shortest context tier. Storage is a separate time-based charge.
- [MiniMax pricing](https://platform.minimax.io/docs/guides/pricing-paygo): M3's
  permanent 50% discount, at up to 512K input tokens. M2/M2.1/M2.5/M2.7 and their
  listed highspeed variants match the existing entries.
- [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/): use the
  peak reference rate; off-peak costs half as much. V4 Flash requests now route to
  V4.1 Flash. Retired `deepseek-chat` and `deepseek-reasoner` entries retain their
  previous historical reference values instead of being relabelled as current
  Flash requests.
- [Z.AI pricing](https://docs.z.ai/guides/overview/pricing): existing listed
  GLM-5.2/5.1/5, GLM-4.7/4.6/4.5 variants and GLM-4-32B rates match.
- [Cursor pricing](https://cursor.com/docs/models-and-pricing): standard Composer
  2.5 and Grok 4.5 rates match. Explicit Composer 2.5 and Grok 4.5/4.6 Fast IDs now resolve separate rates.

This is a sweep of current published rates for existing catalog families, plus
missing Astra/Mythos/alias entries. It is not a certification of every historical
model, reseller alias, or newly released model. Older OpenAI and Gemini entries,
retired Claude models, Cursor Auto, and unlisted GLM variants were not fully
reverified against historical rate cards and remain unchanged.

## Cursor and Devin follow-up

Added Cursor's missing model entries and Fast rates. Values below are
input/output/cache-read; cache writes mirror input when not separately priced:

| Model                                  | Input | Output | Cache read |
| -------------------------------------- | ----: | -----: | ---------: |
| Grok 4.6 (including `cursor-grok-4.6`) |     2 |      6 |        0.5 |
| Grok 4.6 Fast                          |     4 |     12 |          1 |
| Grok 4.5 Fast                          |     4 |     18 |          1 |
| Composer 2.5 Fast                      |     3 |     15 |        0.5 |
| Gemini 3.1 Pro                         |     2 |     12 |        0.2 |
| Gemini 3.8 Flash                       |  0.75 |    3.5 |      0.075 |
| Muse Spark 1.3                         |  1.25 |   4.25 |       0.15 |

Verified against the [Cursor rate card](https://cursor.com/docs/models-and-pricing)
and model pages for [Grok 4.6](https://cursor.com/docs/models/grok-4-6),
[Composer 2.5](https://cursor.com/docs/models/cursor-composer-2-5),
[Muse Spark 1.3](https://cursor.com/docs/models/muse-spark-1-3),
[Gemini 3.1 Pro](https://cursor.com/docs/models/gemini-3-1-pro), and
[Gemini 3.8 Flash](https://cursor.com/docs/models/gemini-3-8-flash).
An effort before `-fast` resolves the explicit Fast row before family fallback.
This keeps `cursor-grok-4.6-high-fast` from using a default or standard rate.
Standard IDs stay standard; no paid-plan or speed inference is made from a bare ID.
Cursor Auto bills by the routed model, and some plans add a separate token fee;
the historical `default` entry cannot reproduce that account-specific billing.

There is no Devin model-price catalog in this repository. The existing Devin
integration is a CLI registry/launcher. [Devin CLI models](https://docs.devin.ai/cli/models)
are discovered in its own selector and include dynamic aliases, Adaptive and
Fusion. [Devin billing](https://docs.devin.ai/admin/billing) uses quotas/credits
or enterprise ACUs, not a published universal USD-per-million-token Devin price.
No invented `devin`/`swe` token rate or fabricated model list is added. Updating a
Devin selector or account-plan catalog requires identifying that separate surface.

## Calculation limits found during the sweep

The resolver accepts only a model ID. A model ID alone cannot reconstruct the
actual billed service tier, request size, cache lifetime, region, or request date.
These remain explicit follow-up work; this rate-card correction does not claim
to implement them:

- [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) charges twice
  the input/cache rate and 1.5 times output above 272K input tokens. Fast doubles
  applicable rates; Batch/Flex halve them. The current lookup returns standard
  Astra rates even for effort/speed-suffixed model labels; only explicitly listed
  Cursor Fast variants have separate rate entries.
- Fable's one-hour cache creation costs 20 rather than the five-minute 12.5.
  The current stored token split has one undifferentiated cache-write count.
- Gemini and MiniMax also have context/tier modifiers; DeepSeek has time-of-week
  pricing. Cache storage, server-side tools and regional charges are separate.
- `recompute_session_usage` prices aggregate tokens using the latest model. A
  mixed-model session therefore needs per-request attribution before its
  estimate can be accurate. Request-log costs already resolve each row's model,
  but neither path has complete billing metadata.

Do not apply a request context threshold to a session's accumulated input tokens:
several short requests must not become one long-context request. Capturing the
missing metadata at provider/import boundaries and pricing each request is a
separate change from correcting this static reference table.

## Persistence and rollback

No source token records, real user databases, schemas, or recorded costs are
rewritten. Newly computed estimates and model tooltips use the corrected rates;
persisted session estimates update when the existing recomputation path runs.
There is no automatic historical backfill or time-versioned rate history.
Historical invoice reconciliation cannot be recovered from aggregate counts.
Rollback is a code revert and rebuild; already recomputed estimates can be
recomputed with the reverted catalog through the existing path.

## Architecture review and verification scope

Applied the architecture checklist to the pricing boundary: compilation (1),
production call paths (2), names and units (3–4), exact/normalized/family/default
resolution (5), ownership (6), estimate documentation (7), unchanged wire shape
(8), shared catalog initialization (9), and all four rates resolving together
(10). Broader application refactoring was not part of the review. The existing
bounded, process-local catalog cache and all lifecycle behavior are unchanged;
no polling, scans, subscriptions or background work are introduced.

Regression tests assert independent published values for exact, qualified,
case-folded, date-pinned and effort-suffixed IDs. A SQLite test calls the production
session recomputation function and reads back persisted costs for Astra, Fable,
Mythos and the GPT-5.6 family. No UI components changed; source-level and SQLite
verification cover the correction, so screenshots add no useful evidence.
