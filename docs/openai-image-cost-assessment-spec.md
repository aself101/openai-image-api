# OpenAI Image Cost Assessment: Specification and Algorithm

## Purpose

Combine OpenAI's organization Images usage endpoint and Costs endpoint into a useful image cost assessment using only the data those endpoints expose.

This is a reconciliation report, not request-level billing. The endpoints do not expose a shared generation/request ID. The Costs endpoint also does not document `model` as a grouping dimension, while the Images endpoint does. Therefore, results must preserve the distinction between measured cost and inferred/estimated attribution.

## Endpoints and available fields

### Images usage

`GET /organization/usage/images`

Useful query controls include time range, bucket width (`1m`, `1h`, `1d`), model, project, API key, user, size, source, and group-by dimensions including `project_id`, `user_id`, `api_key_id`, `model`, `size`, and `source`.

Each grouped result can provide image count and request count, with selected dimensions. This endpoint reports activity counts, not dollar amounts.

### Costs

`GET /organization/costs`

Supports a time range, daily buckets only (`1d`), optional project/API-key filters, and grouping by `project_id`, `api_key_id`, and/or `line_item`. It does not document model as a grouping dimension. Cost results may include amount/currency and optional line item, project, API key, quantity, and quantity unit. Ungrouped example rows have null dimensions and quantity fields.

## Assessment output

For each daily bucket and available attribution scope, produce:

- `period_start`, `period_end` (UTC Unix timestamps and readable dates).
- `scope`: organization, project, API key, or project + API key.
- `project_id`, `api_key_id` when known.
- `image_count`, `image_request_count` from Images.
- `classified_image_cost` and currency, only for cost rows confidently classified as image-generation cost.
- `unclassified_cost`: cost rows that cannot confidently be identified as image costs.
- `total_cost`: all cost rows at that scope, clearly labeled as all-API cost where applicable.
- `average_cost_per_image`: only when classified image cost and a compatible image count share the exact bucket and scope; otherwise null.
- `attribution_level`: `exact_scope_reconciliation`, `image_line_item_reconciliation`, `shared_scope_estimate`, or `unattributed`.
- `warnings`: missing dimensions, pagination gaps, classification uncertainty, scope mismatch, or missing endpoint data.

Never emit a model-specific actual cost from these two endpoints unless a cost row itself explicitly identifies the model and the line item is unambiguously image-specific. Otherwise model-level cost is not available from this data.

## Query plan

1. Require `start_time` inclusive and `end_time` exclusive in UTC. Use the same values for both endpoints.
2. Use daily buckets. Costs supports only `1d`; request Images with `1d` as well so bucket boundaries align.
3. Fetch all pages from both endpoints before computing totals. Do not treat a partial page as a complete report.
4. Request Images grouped by every available dimension useful to the UI: `project_id`, `api_key_id`, `user_id`, `model`, `size`, and `source`. If provider limits combinations, use the strongest shared scope (`project_id`, `api_key_id`) and fetch a second Images breakdown by model/size/source for display, without adding those rows together.
5. Request Costs grouped by `project_id`, `api_key_id`, and `line_item`. Do not group separate requests by different dimensions and sum those reports together; that would double count.
6. Preserve null dimensions as an explicit `unknown` value. Do not silently treat null as equal to a known project/key.
7. Apply project/API-key filters consistently to both calls if the user selected them. Do not filter costs to image lines unless their exact line-item names have been validated; initially fetch all line items so unmatched spend remains visible.

## Line-item classification

Because the documented Costs schema does not guarantee a universal image line-item label, classification must be conservative and inspect actual returned `line_item` strings.

Maintain a small, versioned classifier:

- `image_generation`: exact known line-item values documented/observed for image generation.
- `other_known`: exact known non-image categories, if needed for display.
- `unknown`: null, unrecognized, or ambiguous values.

Do not classify a line item as image spend based only on a substring unless the rule is validated against actual API output and covered by a regression fixture. Store the original line item in the assessment for auditability.

If all costs are returned in a single null-line-item row, the row is `unclassified_cost`, even if Images reports activity in the same day. Co-occurrence is not proof of attribution.

## Join and aggregation algorithm

### Normalization

Normalize every endpoint row into:

```text
bucket_key = (start_time, end_time)
shared_scope_key = (project_id-or-UNKNOWN, api_key_id-or-UNKNOWN)
image_detail_key = (bucket_key, shared_scope_key, user_id, model, size, source)
cost_detail_key = (bucket_key, shared_scope_key, line_item)
```

Normalize absent optional dimensions to an explicit `UNKNOWN` sentinel, distinct from any literal identifier. Normalize currency codes to lowercase ISO code. Keep money in decimal/minor-unit safe representation; do not use binary floating point for sums.

### Build per-scope image counts

- Retain the full Images detail rows for drilldown.
- Build an additional aggregate keyed only by `(bucket_key, shared_scope_key)` by summing each unique Images result exactly once.
- If the API response has multiple result rows due to model/size/source/user breakdown, sum those rows to the shared scope only within that one complete grouping result. Never combine overlapping query variants.
- Track whether the aggregate has unknown project/key dimensions.

### Build per-scope costs

- Retain each cost row and classify its line item.
- Aggregate amounts by `(bucket_key, shared_scope_key, classification, currency)`.
- Also calculate all-API cost for the scope by summing all cost rows once. Keep image-classified, other-known, and unknown separate.
- If rows are grouped by line item but project/key is null, they remain organization-scope rows and must not be copied onto each project/key.

### Join precedence

For each bucket:

1. **Project + API key exact scope:** join only rows with the same known project ID and API key ID.
2. **Project scope:** if both records have the same known project but one or both API key IDs are unknown, expose project totals separately. Do not add project totals to API-key child totals.
3. **API-key scope:** if both records have the same known API key but project is unknown, expose key totals separately.
4. **Organization scope:** use only rows where both project and API key are unknown. These are organization totals, not per-project totals.
5. Never join a known dimension to `UNKNOWN` and call it exact. If the user asks for a broad estimate, show the unmatched aggregate separately and mark it `shared_scope_estimate` with a warning.

`image_count` and `classified_image_cost` may be paired for average cost only at the narrowest identical scope. The average is `classified_image_cost / image_count`; it is a blended average for that scope and period, not a per-model price or a per-request exact cost.

### Coverage / reconciliation

For every bucket and scope:

- `total_cost` is the sum of returned cost rows at that scope.
- `classified_image_cost` is the sum of only confidently image-classified rows.
- `unclassified_cost` is the sum of null/unknown line-item rows.
- `other_known_cost` is excluded from image spend.
- `image_cost_coverage` is `classified_image_cost / total_cost` when total is positive and currencies match; otherwise null.
- Report cost-only rows and image-only rows too. Absence from one endpoint must not erase the other endpoint's data.
- A difference between total cost and image-classified cost is not an error: the scope may include other API products.

## Pseudocode

```text
function assess(imagePages, costPages):
    assert all pages are complete (has_more == false after pagination)

    imageRows = normalizeImages(imagePages)
    costRows = normalizeCosts(costPages)

    imageByScope = aggregateUniqueImageRows(
        imageRows,
        key = (bucket, project_id, api_key_id)
    )

    costByScope = aggregateCosts(
        costRows,
        key = (bucket, project_id, api_key_id, currency, line_item_class)
    )

    scopes = union(keys(imageByScope), keys(costByScope))
    assessments = []

    for scope in scopes:
        images = imageByScope[scope] or zeroImages()
        costs = costByScope[scope] or zeroCosts()

        imageCost = costs.amount[class = IMAGE_GENERATION]
        unknownCost = costs.amount[class = UNKNOWN]
        otherCost = costs.amount[class = OTHER_KNOWN]
        allCost = imageCost + unknownCost + otherCost

        exact = scope dimensions are known and identical on both sides
        canAverage = exact and imageCost exists and images.count > 0

        assessments.append({
            bucket: scope.bucket,
            scope: classifyScope(scope),
            image_count: images.count,
            image_request_count: images.requests,
            classified_image_cost: imageCost or null,
            unclassified_cost: unknownCost or null,
            other_known_cost: otherCost or null,
            total_cost: allCost or null,
            average_cost_per_image: imageCost / images.count if canAverage else null,
            attribution_level: chooseAttributionLevel(exact, imageCost, unknownCost),
            warnings: deriveWarnings(scope, images, costs)
        })

    return sort(assessments, bucket ascending, scope specificity descending)
```

Implementation must ensure that image report variants are not double-counted. If multiple image queries are needed to obtain compatible groupings, designate one query result as the authoritative count source and treat other query results as breakdowns only.

## Worked interpretation of the supplied example

The sample rows both use bucket `[1730419200, 1730505600)`, but all dimensions are null. Images reports 2 images; Costs reports $0.06 with null line item, project, API key, and quantity.

The correct assessment is:

- organization-scope image count: 2
- organization-scope total API cost: $0.06
- image-classified cost: unavailable / null
- unclassified cost: $0.06
- average image cost: null
- attribution: `unattributed`
- warning: cost row has no line item or scope dimensions, so it cannot be attributed specifically to images.

Also show the bucket dates in UTC. The supplied timestamps correspond to a historical bucket, so do not label it as current activity unless the request range confirms that.

## Acceptance criteria

- Calls use identical UTC time bounds and daily bucket boundaries.
- All pages are fetched before totals are reported.
- Cost rows are grouped by project, API key, and line item when supported.
- Image and cost dimensions are joined only at a compatible scope; null does not match a known ID.
- No image-only cost is inferred from temporal co-occurrence.
- Unknown line items remain visible as unclassified cost.
- Amounts are summed without floating-point drift and currencies are never mixed.
- Model, size, or user detail is reported as usage breakdown only unless the cost endpoint explicitly provides a matching dimension.
- Output preserves raw source rows or enough provenance to audit each aggregate.
- Cost-only and image-only buckets remain visible.

## References

- [Images usage endpoint](https://developers.openai.com/api/reference/go/resources/admin/subresources/organization/subresources/usage/methods/images)
- [Costs endpoint](https://developers.openai.com/api/reference/cli/resources/admin/subresources/organization/subresources/usage/methods/costs)

---

## Revision 2026-09-21: what the live API showed, and what it changed

The sections above are the specification as written before any call was made. They were implemented as written (`src/cost.ts`, 3.1.0 development), then run against a live organization with GPT Image spend on 2026-09-20 and 2026-09-21. Four findings changed the algorithm; the constraints that made the original conservative are kept. Endpoint dumps consulted are in `docs/reference/` (`costs.md`, `image-costs.md`).

### F1. `quantity_unit` is `tokens`, never `images` — the documented image signal does not occur

Every Costs row observed carried `quantity_unit: "tokens"`. The classifier as specified (unit `images`, or an exact-match list that starts empty) classified **100% of real image spend as unclassified**. The report was correct by its own rules and useless.

### F2. Costs line items name the model and the component

Observed `line_item` values, all of one form:

```
gpt-image-2.5-flare image, output
gpt-image-2.5-flare text, input
gpt-image-1.5-2025-12-16 image, cached input
gpt-image-1 text, input
```

That is `<model> <image|text>, <input|cached input|output>`, with `quantity` in tokens. The specification said: *never emit a model-specific cost unless a cost row itself explicitly identifies the model and the line item is unambiguously image-specific.* This line-item form satisfies that condition — the row names the model. **Model-level cost is available** from these endpoints, and the report now emits it.

Classification is now: unit `images` → image spend (kept for the DALL-E-era vocabulary); else parse the line item with a strict regular expression and classify by the model's prefix (`gpt-image-`, `dall-e-`, `chatgpt-image`); else the exact-match lists; else unknown. Text-modality rows on an image model (`gpt-image-2.5-flare text, input` — the prompt tokens) are image spend: they are cost of producing images. Nothing classifies on a substring.

### F3. `/organization/usage/images` reports no GPT Image activity

On days with $0.90 of GPT Image spend the Images-usage endpoint returned zero rows. It carries the DALL-E-era `image.generation` / `image.edit` / `image.variation` sources. GPT Image activity is reported by **`/organization/usage/completions`**, grouped by `model`, with `num_model_requests`, `input_text_tokens`, `input_image_tokens`, `input_cached_tokens`, `output_text_tokens`, `output_image_tokens`. It also reports every text model the organization used; rows whose model is not an image model are dropped and counted in a warning.

The query plan is therefore three calls, not two: completions (grouped `project_id`, `api_key_id`, `model`), images (grouped by every display dimension, kept for DALL-E-era organizations), costs (grouped `project_id`, `api_key_id`, `line_item`, no line-item filter). The function signature is `assessImageCosts(imagePages, completionPages, costPages, range)`.

### F4. The two sides reconcile to the token

Within one UTC day and one project + API-key scope, joining by model id: usage `output_image_tokens` equalled the cost row's `quantity` for `image, output` on every one of the 7 model-rows observed across four model families, including edit input images (`input_image_tokens: 1024` ↔ `image, input` quantity 1024) and text output (`gpt-image-1.5`: 1556 ↔ 1556). The report now computes `tokens_reconcile` per model row and warns on any mismatch. One naming asymmetry: costs said `gpt-image-1` where usage said `gpt-image-1-2025-04-23`. Rows match exactly first, then by *family* (the id with a trailing `-YYYY-MM-DD` removed), and a family match is labelled as such.

### Also observed

- **Amounts are 34-digit decimals** on the wire (`0.0001050000000000000000000000000000000`, `0E-6176`). `JSON.parse` would round them through a double. The client quotes the `"value"` literal before parsing and the algorithm parses the text into an integer at 12 decimal places (`AMOUNT_SCALE`). Micro-units (6 places) would have truncated real rows.
- **Costs lag usage.** Usage for the current UTC day is visible within minutes; the matching cost rows post later. A model with usage and no cost is reported `activity_only` with a re-run notice, never as free.
- **Buckets are UTC days on both sides.** The CLI snaps `--start` down and `--end` up to UTC midnight and prints the effective range; a bucket that runs past the requested end is marked `partial`.
- **Foreign-currency rows are excluded atomically.** A scope's currency is that of its first amount-bearing row; a row in another currency is excluded from every total at that scope and listed in `excluded_foreign_currency`, so no figure at a scope mixes currencies and no row lands in one total but not another.
- **`UNKNOWN` sentinel** for an absent dimension is `␀UNKNOWN` (U+2400) — non-ASCII, so it cannot collide with an id, and valid text where a NUL byte is not.

### Output changes

Per row: `partial`, `output_image_tokens`, `input_image_tokens`, `average_cost_per_request`, `excluded_foreign_currency`, and `models[]` — one entry per model at that scope and day with `match` (`exact` | `family` | `cost_only` | `activity_only`), request and token counts, a per-component cost breakdown (`image_input`, `image_cached_input`, `image_output`, `text_input`, `text_cached_input`, `text_output`, `total`), the cost-side `cost_quantities`, `tokens_reconcile`, and averages. Report-level: `observed_models`, `totals.output_image_tokens`, `totals.by_model` (per family and currency). `attribution_level` keeps its four values and its meaning.

### Acceptance criteria — status

All ten original criteria hold, with one read against F2: *"Model … detail is reported as usage breakdown only unless the cost endpoint explicitly provides a matching dimension"* — it does, in the line item, and model-level cost is emitted only from rows that name the model. Added: completions and images are both read and either may be empty; token quantities are compared where both sides carry them; amounts are parsed exactly from their decimal text.

### Worked example — still holds

The all-null $0.06 / 2-image example above produces the same assessment (organization scope, unclassified $0.06, `unattributed`). The live example that replaced it as the regression fixture: 2026-09-20, `gpt-image-2.5-flare`, 5 requests, 2183 output image tokens ↔ `"gpt-image-2.5-flare image, output"` quantity 2183, $0.06549 — `exact_scope_reconciliation`, `tokens_reconcile: true`, $0.013098 per request.
