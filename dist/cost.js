/**
 * OpenAI Image Cost Assessment — the reconciliation algorithm.
 *
 * Combines organization usage (activity) with organization costs (amounts)
 * into a per-day, per-scope, per-model report. Pure: no I/O. `OpenAIAdminAPI`
 * (admin-api.ts) fetches the pages; this module turns them into an assessment.
 * Spec: docs/openai-image-cost-assessment-spec.md, whose closing revision
 * records what the live API showed on 2026-09-21 and what it changed:
 *
 * - GPT Image model activity is NOT reported by `/organization/usage/images`.
 *   That endpoint carries the DALL-E-era `image.generation|edit|variation`
 *   sources and returned nothing for an organization with GPT Image spend on
 *   the same days. GPT Image activity is reported by
 *   `/organization/usage/completions`, grouped by model, with
 *   `num_model_requests`, `input_image_tokens`, `output_image_tokens`. Both
 *   sources are read here; either may be empty.
 * - Costs line items name the model and the component:
 *   `<model> <image|text>, <input|cached input|output>` with `quantity` in
 *   tokens that matches the usage side to the token. `quantity_unit` was
 *   `tokens`, never `images`. That structured string satisfies the spec's
 *   condition for model-level cost: the cost row itself identifies the model.
 * - Amounts arrive as 34-digit decimals (`0.0001050000…`, `0E-6176`). They are
 *   parsed from their text, not from a double, and held as integers at
 *   AMOUNT_SCALE decimal places.
 *
 * What stays as the spec demanded: scopes join only on KNOWN, equal project
 * and API-key ids; an all-null row is organization scope, never copied onto
 * projects; unrecognised line items remain visible as unclassified spend;
 * co-occurrence is not attribution; every aggregate keeps its source rows.
 */
// =============================================================================
// Money: exact decimal text → integer at a fixed scale, per currency
// =============================================================================
/** Decimal places every amount is held at (1 unit = 1e-12 of the currency) */
export const AMOUNT_SCALE = 12;
const SCALE = 10n ** BigInt(AMOUNT_SCALE);
/**
 * Parse a decimal amount to an integer at AMOUNT_SCALE.
 *
 * Strings are parsed exactly (plain and exponent forms; `0E-6176` and
 * `0.1664000000000000000000000000000000` both occur on the wire). Numbers go
 * through their shortest round-trip string, which is the decimal the API meant
 * for values a double represents cleanly (0.06 → "0.06"). Digits beyond the
 * twelfth decimal are rounded half-up, once, per row.
 *
 * @param value - Decimal text as the API sends it, or a finite number
 * @returns The amount as an integer at AMOUNT_SCALE decimal places
 * @throws TypeError For a non-finite number or a string that is not a decimal
 * @example
 * toScaled('0.0001050000000000000000000000000000000'); // 105000000n
 */
export function toScaled(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new TypeError(`Cost amount is not a finite number: ${String(value)}`);
    }
    const text = typeof value === 'number' ? String(value) : value.trim();
    const m = /^([+-])?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!m)
        throw new TypeError(`Cost amount is not a decimal: "${text}"`);
    const negative = m[1] === '-';
    const intPart = m[2] ?? '0';
    const fracPart = m[3] ?? '';
    const exponent = m[4] ? parseInt(m[4], 10) : 0;
    let digits = intPart + fracPart;
    let scale = fracPart.length - exponent; // digits after the decimal point
    if (scale < 0) {
        digits += '0'.repeat(-scale);
        scale = 0;
    }
    let result;
    if (scale <= AMOUNT_SCALE) {
        result = BigInt(digits) * 10n ** BigInt(AMOUNT_SCALE - scale);
    }
    else {
        const cut = digits.length - (scale - AMOUNT_SCALE);
        result = BigInt(digits.slice(0, cut) || '0');
        if ((digits.charCodeAt(cut) || 48) >= 53 /* '5' */)
            result += 1n;
    }
    return negative ? -result : result;
}
/**
 * Render a scaled amount as a decimal string: at least two decimals, trailing
 * zeros beyond that trimmed, at most `maxDecimals` (truncated, not rounded).
 *
 * @param scaled - An integer at AMOUNT_SCALE decimal places, as from toScaled
 * @param maxDecimals - Decimal places to keep (default AMOUNT_SCALE)
 * @returns Decimal text, e.g. `0.06549`, `1.00`, `-0.05`
 */
export function formatAmount(scaled, maxDecimals = AMOUNT_SCALE) {
    const negative = scaled < 0n;
    const abs = negative ? -scaled : scaled;
    const whole = abs / SCALE;
    let frac = (abs % SCALE).toString().padStart(AMOUNT_SCALE, '0').slice(0, Math.max(0, maxDecimals));
    frac = frac.replace(/0+$/, '');
    if (frac.length < 2)
        frac = frac.padEnd(2, '0');
    return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}
/**
 * Parse the `<model> <image|text>, <input|cached input|output>` line-item form.
 *
 * Observed live 2026-09-21 for every GPT Image row (`gpt-image-2.5-flare
 * image, output`, `gpt-image-1.5-2025-12-16 text, input`, …). Anything else
 * returns null and is classified unknown — a structured parse with a
 * regression fixture, not a substring test.
 *
 * @param lineItem - The Costs row's `line_item`
 * @returns The model, modality and component, or null when the string is not of that form
 */
export function parseLineItem(lineItem) {
    if (!lineItem)
        return null;
    const m = /^(\S+) (image|text), (cached input|input|output)$/.exec(lineItem);
    if (!m)
        return null;
    return { model: m[1] ?? '', modality: m[2], component: m[3] };
}
/** Model-id prefixes that denote image models */
export const IMAGE_MODEL_PREFIXES = ['gpt-image-', 'dall-e-', 'chatgpt-image'];
/**
 * Whether a model id is an image model by prefix.
 *
 * @param model - Model id as either endpoint names it
 * @returns True for `gpt-image-*`, `dall-e-*`, `chatgpt-image*`
 */
export const isImageModel = (model) => IMAGE_MODEL_PREFIXES.some((p) => model.startsWith(p));
/**
 * Exact `line_item` strings known to be image spend without parsing. Empty:
 * every observed image line item parses. Kept for a vocabulary that may not.
 * Bump LINE_ITEM_CLASSIFIER_VERSION when either list or the parser changes.
 */
export const IMAGE_LINE_ITEMS = new Set([]);
export const OTHER_KNOWN_LINE_ITEMS = new Set([]);
export const LINE_ITEM_CLASSIFIER_VERSION = '2026-09-21.2';
/**
 * Classify one cost row. Signals, in order: a documented `quantity_unit` of
 * `images`; a parsed `<model> …` line item whose model is an image model; an
 * exact-match list. Everything else is `unknown` and stays visible.
 *
 * @param row - The Costs row's `line_item` and `quantity_unit`
 * @returns `image_generation`, `other_known`, or `unknown`
 */
export function classifyCostRow(row) {
    if (row.quantity_unit === 'images')
        return 'image_generation';
    const parsed = parseLineItem(row.line_item);
    if (parsed && isImageModel(parsed.model))
        return 'image_generation';
    const item = row.line_item ?? null;
    if (item !== null && IMAGE_LINE_ITEMS.has(item))
        return 'image_generation';
    if (item !== null && OTHER_KNOWN_LINE_ITEMS.has(item))
        return 'other_known';
    return 'unknown';
}
/**
 * Model family: the id with a trailing `-YYYY-MM-DD` snapshot removed. Costs
 * said `gpt-image-1` where usage said `gpt-image-1-2025-04-23` for the same
 * activity; the two sides match exactly first, then by family.
 *
 * @param model - Model id
 * @returns The id without a trailing snapshot date
 */
export const modelFamily = (model) => model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
// =============================================================================
// Normalized rows
// =============================================================================
/**
 * Sentinel for an absent optional dimension. U+2400 (␀, "symbol for null") is
 * not ASCII, so it cannot collide with any project, key, user or model id, and
 * it is valid text everywhere a NUL byte would not be (Postgres `text`, JSON).
 * AssessmentRow output renders it as null; only the exported normalize*
 * intermediates carry it.
 */
export const UNKNOWN = '␀UNKNOWN';
const dim = (v) => (v === null || v === undefined || v === '' ? UNKNOWN : v);
const bucketKey = (b) => ({ start_time: b.start_time, end_time: b.end_time });
const n0 = (v) => v ?? 0;
/**
 * A report built from a partial page set would silently under-report. Every
 * page but the last must say has_more=true (or the sequence has a gap), and
 * the last must say has_more=false.
 */
function assertComplete(pages, endpoint) {
    pages.forEach((page, i) => {
        const last = i === pages.length - 1;
        if (last && page.has_more) {
            throw new Error(`${endpoint}: the last page still has has_more=true (next_page=${String(page.next_page)}); fetch every page before assessing`);
        }
        if (!last && !page.has_more) {
            throw new Error(`${endpoint}: page ${i} has has_more=false but ${pages.length - i - 1} more page(s) follow; the sequence has a gap`);
        }
    });
}
/**
 * Normalize Images-usage pages.
 *
 * @param pages - Every page of ONE images-usage query, in order
 * @returns Activity rows (source `images`) and the results of other types that were skipped
 * @throws Error When the page set is incomplete or has a gap
 */
export function normalizeImages(pages) {
    assertComplete(pages, 'images');
    const rows = [];
    const skipped = [];
    pages.forEach((page, p) => page.data.forEach((bucket, b) => bucket.results.forEach((r, i) => {
        if (r.object !== 'organization.usage.images.result') {
            skipped.push({ endpoint: 'images', object: r.object, provenance: ['images', p, b, i] });
            return;
        }
        const row = r;
        rows.push({
            bucket: bucketKey(bucket),
            scope: { project_id: dim(row.project_id), api_key_id: dim(row.api_key_id) },
            source: 'images',
            model: dim(row.model),
            user_id: dim(row.user_id),
            requests: row.num_model_requests,
            images: row.images,
            input_text_tokens: 0,
            input_image_tokens: 0,
            input_cached_tokens: 0,
            output_text_tokens: 0,
            output_image_tokens: 0,
            size: dim(row.size),
            image_source: dim(row.source),
            provenance: ['images', p, b, i],
        });
    })));
    return { rows, skipped };
}
/**
 * Normalize Completions-usage pages, keeping only image-model rows (the
 * endpoint also reports every text model the organization used). The count
 * of dropped non-image rows is returned so the report can say so.
 *
 * @param pages - Every page of ONE completions-usage query, in order
 * @returns Activity rows (source `completions`), skipped results, and the number of non-image-model rows dropped
 * @throws Error When the page set is incomplete or has a gap
 */
export function normalizeCompletions(pages) {
    assertComplete(pages, 'completions');
    const rows = [];
    const skipped = [];
    let nonImageModelRows = 0;
    pages.forEach((page, p) => page.data.forEach((bucket, b) => bucket.results.forEach((r, i) => {
        if (r.object !== 'organization.usage.completions.result') {
            skipped.push({ endpoint: 'completions', object: r.object, provenance: ['completions', p, b, i] });
            return;
        }
        const row = r;
        if (!row.model || !isImageModel(row.model)) {
            nonImageModelRows++;
            return;
        }
        rows.push({
            bucket: bucketKey(bucket),
            scope: { project_id: dim(row.project_id), api_key_id: dim(row.api_key_id) },
            source: 'completions',
            model: row.model,
            user_id: dim(row.user_id),
            requests: row.num_model_requests,
            images: null,
            input_text_tokens: n0(row.input_text_tokens),
            input_image_tokens: n0(row.input_image_tokens),
            input_cached_tokens: n0(row.input_cached_tokens),
            output_text_tokens: n0(row.output_text_tokens),
            output_image_tokens: n0(row.output_image_tokens),
            size: UNKNOWN,
            image_source: UNKNOWN,
            provenance: ['completions', p, b, i],
        });
    })));
    return { rows, skipped, nonImageModelRows };
}
/**
 * Normalize Costs pages: exact-decimal amounts, lowercase currency, parsed and classified line items.
 *
 * @param pages - Every page of ONE costs query, in order
 * @returns Cost rows and the results of other types that were skipped
 * @throws Error When the page set is incomplete or has a gap; TypeError when an amount is not a decimal
 */
export function normalizeCosts(pages) {
    assertComplete(pages, 'costs');
    const rows = [];
    const skipped = [];
    pages.forEach((page, p) => page.data.forEach((bucket, b) => bucket.results.forEach((r, i) => {
        if (r.object !== 'organization.costs.result') {
            skipped.push({ endpoint: 'costs', object: r.object, provenance: ['costs', p, b, i] });
            return;
        }
        const row = r;
        const value = row.amount?.value;
        const amount = value === null || value === undefined
            ? null
            : { currency: (row.amount?.currency ?? 'usd').toLowerCase(), scaled: toScaled(value) };
        rows.push({
            bucket: bucketKey(bucket),
            scope: { project_id: dim(row.project_id), api_key_id: dim(row.api_key_id) },
            line_item: dim(row.line_item),
            parsed: parseLineItem(row.line_item),
            classification: classifyCostRow(row),
            amount,
            quantity: row.quantity ?? null,
            quantity_unit: row.quantity_unit ?? null,
            provenance: ['costs', p, b, i],
        });
    })));
    return { rows, skipped };
}
const scopeId = (b, s) => `${b.start_time}|${b.end_time}|${s.project_id}|${s.api_key_id}`;
const iso = (unix) => new Date(unix * 1000).toISOString();
const shown = (d) => (d === UNKNOWN ? null : d);
const levelOf = (s) => s.project_id !== UNKNOWN && s.api_key_id !== UNKNOWN
    ? 'project_api_key'
    : s.project_id !== UNKNOWN
        ? 'project'
        : s.api_key_id !== UNKNOWN
            ? 'api_key'
            : 'organization';
const SPECIFICITY = { project_api_key: 3, project: 2, api_key: 1, organization: 0 };
const componentKey = (p) => `${p.modality}_${p.component.replace(' ', '_')}`;
const COMPONENTS = [
    'image_input',
    'image_cached_input',
    'image_output',
    'text_input',
    'text_cached_input',
    'text_output',
];
/** Per-model reconciliation within one scope aggregate (foreign-currency rows already excluded) */
function assessModels(a) {
    const activityByModel = new Map();
    for (const r of a.activity) {
        if (r.model === UNKNOWN)
            continue;
        activityByModel.set(r.model, [...(activityByModel.get(r.model) ?? []), r]);
    }
    const costByModel = new Map();
    for (const r of a.costs) {
        if (r.parsed && r.classification === 'image_generation' && !a.foreign.includes(r)) {
            costByModel.set(r.parsed.model, [...(costByModel.get(r.parsed.model) ?? []), r]);
        }
    }
    const build = (costModel, activityModel, match, costRows, activityRows) => {
        const warnings = [];
        const cost = {
            image_input: null,
            image_cached_input: null,
            image_output: null,
            text_input: null,
            text_cached_input: null,
            text_output: null,
        };
        const qty = {
            image_input: null,
            image_cached_input: null,
            image_output: null,
            text_input: null,
            text_cached_input: null,
            text_output: null,
        };
        let total = null;
        for (const r of costRows) {
            if (!r.parsed)
                continue;
            const k = componentKey(r.parsed);
            if (r.amount) {
                cost[k] = (cost[k] ?? 0n) + r.amount.scaled;
                total = (total ?? 0n) + r.amount.scaled;
            }
            if (r.quantity !== null && r.quantity_unit === 'tokens')
                qty[k] = (qty[k] ?? 0) + r.quantity;
        }
        const has = activityRows.length > 0;
        const sum = (f) => (has ? activityRows.reduce((n, r) => n + f(r), 0) : null);
        const requests = sum((r) => r.requests);
        const withImages = activityRows.filter((r) => r.images !== null);
        const images = withImages.length ? withImages.reduce((n, r) => n + (r.images ?? 0), 0) : null;
        const tokens = {
            input_text_tokens: sum((r) => r.input_text_tokens),
            input_image_tokens: sum((r) => r.input_image_tokens),
            input_cached_tokens: sum((r) => r.input_cached_tokens),
            output_text_tokens: sum((r) => r.output_text_tokens),
            output_image_tokens: sum((r) => r.output_image_tokens),
        };
        let reconcile = null;
        if (has && costRows.length) {
            reconcile = true;
            const pairs = [
                ['image output', tokens.output_image_tokens, qty.image_output],
                ['image input', tokens.input_image_tokens, qty.image_input],
                ['text input', tokens.input_text_tokens, qty.text_input],
                ['text output', tokens.output_text_tokens, qty.text_output],
            ];
            for (const [label, usage, costQty] of pairs) {
                if (costQty === null || usage === null)
                    continue;
                if (usage !== costQty) {
                    reconcile = false;
                    warnings.push(`${label} tokens: usage reports ${usage}, cost quantity is ${costQty}`);
                }
            }
        }
        if (match === 'family')
            warnings.push(`matched by model family: cost names "${costModel ?? ''}", usage names "${activityModel ?? ''}"`);
        if (match === 'cost_only')
            warnings.push('cost rows with no usage rows for this model at this scope and day');
        if (match === 'activity_only')
            warnings.push('usage with no cost rows for this model at this scope and day (costs post after usage; re-run later)');
        const fmt = (v) => (v === null ? null : formatAmount(v));
        return {
            model: costModel ?? activityModel ?? UNKNOWN,
            activity_model: activityModel,
            family: modelFamily(costModel ?? activityModel ?? ''),
            match,
            requests,
            images,
            ...tokens,
            cost: {
                ...Object.fromEntries(COMPONENTS.map((k) => [k, fmt(cost[k])])),
                total: fmt(total),
            },
            cost_quantities: qty,
            currency: total === null ? null : a.currency,
            average_cost_per_request: total !== null && requests ? formatAmount(total / BigInt(requests)) : null,
            average_cost_per_image: total !== null && images ? formatAmount(total / BigInt(images)) : null,
            tokens_reconcile: reconcile,
            warnings,
        };
    };
    const out = [];
    const claimed = new Set();
    for (const [costModel, costRows] of costByModel) {
        let activityModel = null;
        let match = 'cost_only';
        if (activityByModel.has(costModel)) {
            activityModel = costModel;
            match = 'exact';
        }
        else {
            const fam = modelFamily(costModel);
            const candidates = [...activityByModel.keys()].filter((m) => !claimed.has(m) && modelFamily(m) === fam);
            if (candidates.length === 1) {
                activityModel = candidates[0] ?? null;
                match = 'family';
            }
        }
        if (activityModel)
            claimed.add(activityModel);
        out.push(build(costModel, activityModel, match, costRows, activityModel ? (activityByModel.get(activityModel) ?? []) : []));
    }
    for (const [model, rows] of activityByModel) {
        if (!claimed.has(model))
            out.push(build(null, model, 'activity_only', [], rows));
    }
    return out.sort((x, y) => x.model.localeCompare(y.model));
}
/**
 * Build the assessment from complete page sets.
 *
 * @param imagePages - ONE Images-usage query grouped by project_id, api_key_id (plus display dimensions)
 * @param completionPages - ONE Completions-usage query grouped by project_id, api_key_id, model
 * @param costPages - ONE Costs query grouped by project_id, api_key_id, line_item
 * @param range - The UTC range requested (start inclusive, end exclusive), recorded in the output
 * @returns The assessment; every page array may be empty and the report says which contributed nothing
 * @throws Error If any page array is incomplete (has_more on the last page, or a gap)
 * @example
 * const report = assessImageCosts(imagePages, completionPages, costPages, { start_time, end_time });
 * for (const row of report.rows) for (const m of row.models) console.log(row.period_start_iso, m.model, m.requests, m.cost.total);
 */
export function assessImageCosts(imagePages, completionPages, costPages, range) {
    const images = normalizeImages(imagePages);
    const completions = normalizeCompletions(completionPages);
    const costs = normalizeCosts(costPages);
    const reportWarnings = [];
    for (const s of [...images.skipped, ...completions.skipped, ...costs.skipped]) {
        reportWarnings.push(`${s.endpoint}: skipped a result of type ${s.object} at page ${s.provenance[1]}, bucket ${s.provenance[2]}, result ${s.provenance[3]}`);
    }
    if (imagePages.length === 0)
        reportWarnings.push('images: no pages supplied');
    else if (images.rows.length === 0) {
        reportWarnings.push('images: the endpoint returned no rows (it reports DALL-E-era image.generation/edit/variation activity only; GPT Image activity comes from completions)');
    }
    if (completionPages.length === 0)
        reportWarnings.push('completions: no pages supplied; GPT Image activity is absent, not zero');
    if (completions.nonImageModelRows > 0)
        reportWarnings.push(`completions: ${completions.nonImageModelRows} non-image-model row(s) ignored`);
    if (costPages.length === 0)
        reportWarnings.push('costs: no pages supplied; costs are absent, not zero');
    // --- aggregate to (bucket, scope); a row's amount lands in every total or in none ---
    const aggs = new Map();
    const agg = (b, s) => {
        const id = scopeId(b, s);
        let a = aggs.get(id);
        if (!a) {
            a = { bucket: b, scope: s, activity: [], costs: [], currency: null, byClass: {}, total: 0n, foreign: [] };
            aggs.set(id, a);
        }
        return a;
    };
    for (const r of [...images.rows, ...completions.rows])
        agg(r.bucket, r.scope).activity.push(r);
    for (const r of costs.rows) {
        const a = agg(r.bucket, r.scope);
        a.costs.push(r);
        if (!r.amount)
            continue;
        a.currency ??= r.amount.currency;
        if (r.amount.currency !== a.currency) {
            a.foreign.push(r);
            continue;
        }
        a.byClass[r.classification] = (a.byClass[r.classification] ?? 0n) + r.amount.scaled;
        a.total += r.amount.scaled;
    }
    const observedLineItems = new Set();
    const observedModels = new Set();
    for (const r of costs.rows) {
        if (r.line_item !== UNKNOWN)
            observedLineItems.add(r.line_item);
        if (r.parsed && isImageModel(r.parsed.model))
            observedModels.add(r.parsed.model);
    }
    for (const r of [...images.rows, ...completions.rows])
        if (r.model !== UNKNOWN)
            observedModels.add(r.model);
    // --- emit rows ------------------------------------------------------------
    const rows = [];
    for (const a of aggs.values()) {
        const level = levelOf(a.scope);
        const warnings = [];
        const hasActivity = a.activity.length > 0;
        const hasCosts = a.costs.length > 0;
        const imageCost = a.byClass.image_generation ?? null;
        const unknownCost = a.byClass.unknown ?? null;
        const otherCost = a.byClass.other_known ?? null;
        const hasAnyAmount = a.costs.some((r) => r.amount !== null) && a.currency !== null;
        if (a.foreign.length) {
            warnings.push(`${a.foreign.length} cost row(s) in a currency other than ${a.currency ?? '?'} are excluded from every total at this scope (see excluded_foreign_currency)`);
        }
        if (hasActivity && !hasCosts)
            warnings.push('image activity with no cost rows at this scope and day (costs post after usage, or sit at a broader scope)');
        if (hasCosts && !hasActivity)
            warnings.push('cost with no image activity rows at this scope and day');
        if (level !== 'project_api_key')
            warnings.push(`scope is ${level}: rows with an unknown project or API key are reported here, never copied onto narrower scopes`);
        if (unknownCost !== null && imageCost === null) {
            warnings.push('cost rows have no image-specific signal (line item not in the <model> <image|text>, <component> form, unit not images); co-occurrence with activity is not attribution');
        }
        for (const r of a.costs)
            if (r.amount === null)
                warnings.push(`a cost row (line_item ${shown(r.line_item) ?? 'null'}) has no amount`);
        const exact = level === 'project_api_key';
        let attribution;
        if (imageCost === null)
            attribution = 'unattributed';
        else if (!hasActivity)
            attribution = 'shared_scope_estimate';
        else
            attribution = exact ? 'exact_scope_reconciliation' : 'image_line_item_reconciliation';
        if (attribution === 'shared_scope_estimate')
            warnings.push('estimate: image-classified spend at a scope with no activity rows; the activity may sit at another scope or the usage side lagged');
        if (attribution === 'image_line_item_reconciliation')
            warnings.push('image spend and activity share this scope but not an exact project + API key pair; averages are not computed');
        const requests = hasActivity ? a.activity.reduce((n, r) => n + r.requests, 0) : null;
        const withImages = a.activity.filter((r) => r.images !== null);
        const imageCount = withImages.length ? withImages.reduce((n, r) => n + (r.images ?? 0), 0) : null;
        const outImg = hasActivity ? a.activity.reduce((n, r) => n + r.output_image_tokens, 0) : null;
        const inImg = hasActivity ? a.activity.reduce((n, r) => n + r.input_image_tokens, 0) : null;
        const models = assessModels(a);
        for (const m of models)
            for (const w of m.warnings)
                warnings.push(`${m.model}: ${w}`);
        const fmt = (v) => (v === null ? null : formatAmount(v));
        rows.push({
            period_start: a.bucket.start_time,
            period_end: a.bucket.end_time,
            period_start_iso: iso(a.bucket.start_time),
            period_end_iso: iso(a.bucket.end_time),
            partial: a.bucket.end_time > range.end_time,
            scope: level,
            project_id: shown(a.scope.project_id),
            api_key_id: shown(a.scope.api_key_id),
            image_request_count: requests,
            image_count: imageCount,
            output_image_tokens: outImg,
            input_image_tokens: inImg,
            classified_image_cost: fmt(imageCost),
            unclassified_cost: fmt(unknownCost),
            other_known_cost: fmt(otherCost),
            total_cost: hasAnyAmount ? formatAmount(a.total) : null,
            currency: a.currency,
            excluded_foreign_currency: a.foreign.map((r) => ({
                currency: r.amount?.currency ?? '?',
                amount: r.amount ? formatAmount(r.amount.scaled) : '0.00',
                line_item: shown(r.line_item),
            })),
            average_cost_per_image: exact && imageCost !== null && imageCount ? formatAmount(imageCost / BigInt(imageCount)) : null,
            average_cost_per_request: exact && imageCost !== null && requests ? formatAmount(imageCost / BigInt(requests)) : null,
            image_cost_coverage: imageCost !== null && a.total > 0n ? Number(imageCost) / Number(a.total) : null,
            attribution_level: attribution,
            warnings,
            models,
            line_items: a.costs.map((r) => ({
                line_item: shown(r.line_item),
                classification: r.classification,
                amount: r.amount ? formatAmount(r.amount.scaled) : null,
                currency: r.amount?.currency ?? null,
                quantity: r.quantity,
                quantity_unit: r.quantity_unit,
            })),
            image_breakdown: a.activity
                .filter((r) => r.source === 'images')
                .map((r) => ({
                model: shown(r.model),
                size: shown(r.size),
                source: shown(r.image_source),
                user_id: shown(r.user_id),
                images: r.images ?? 0,
                requests: r.requests,
            })),
            provenance: [...a.activity.map((r) => r.provenance), ...a.costs.map((r) => r.provenance)],
        });
    }
    rows.sort((x, y) => x.period_start - y.period_start ||
        SPECIFICITY[y.scope] - SPECIFICITY[x.scope] ||
        (x.project_id ?? '').localeCompare(y.project_id ?? '') ||
        (x.api_key_id ?? '').localeCompare(y.api_key_id ?? ''));
    // --- totals (per currency; activity per family) --------------------------
    const perCurrency = new Map();
    const perModel = new Map();
    for (const r of costs.rows) {
        if (!r.amount)
            continue;
        const t = perCurrency.get(r.amount.currency) ?? { image: 0n, unknown: 0n, other: 0n, total: 0n };
        if (r.classification === 'image_generation')
            t.image += r.amount.scaled;
        else if (r.classification === 'other_known')
            t.other += r.amount.scaled;
        else
            t.unknown += r.amount.scaled;
        t.total += r.amount.scaled;
        perCurrency.set(r.amount.currency, t);
        if (r.parsed && r.classification === 'image_generation') {
            const fam = modelFamily(r.parsed.model);
            const k = `${fam}|${r.amount.currency}`;
            const m = perModel.get(k) ?? { family: fam, currency: r.amount.currency, requests: 0, outImg: 0, cost: 0n };
            m.cost = (m.cost ?? 0n) + r.amount.scaled;
            perModel.set(k, m);
        }
    }
    const activityRows = [...images.rows, ...completions.rows];
    for (const r of activityRows) {
        if (r.model === UNKNOWN)
            continue;
        const fam = modelFamily(r.model);
        // activity is counted once per family: under its first cost currency (sorted)
        // when the family has cost rows, else with no currency and no cost
        const keys = [...perModel.keys()].filter((k) => k.startsWith(`${fam}|`)).sort();
        const k = keys[0] ?? `${fam}|`;
        const m = perModel.get(k) ?? { family: fam, currency: null, requests: 0, outImg: 0, cost: null };
        m.requests += r.requests;
        m.outImg += r.output_image_tokens;
        perModel.set(k, m);
    }
    return {
        range,
        classifier_version: LINE_ITEM_CLASSIFIER_VERSION,
        rows,
        warnings: reportWarnings,
        observed_line_items: [...observedLineItems].sort(),
        observed_models: [...observedModels].sort(),
        totals: {
            image_request_count: activityRows.reduce((n, r) => n + r.requests, 0),
            image_count: images.rows.length ? images.rows.reduce((n, r) => n + (r.images ?? 0), 0) : null,
            output_image_tokens: activityRows.reduce((n, r) => n + r.output_image_tokens, 0),
            by_currency: [...perCurrency.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([currency, t]) => ({
                currency,
                classified_image_cost: formatAmount(t.image),
                unclassified_cost: formatAmount(t.unknown),
                other_known_cost: formatAmount(t.other),
                total_cost: formatAmount(t.total),
            })),
            by_model: [...perModel.values()]
                .sort((a, b) => a.family.localeCompare(b.family) || (a.currency ?? '').localeCompare(b.currency ?? ''))
                .map((m) => ({
                family: m.family,
                currency: m.currency,
                requests: m.requests,
                output_image_tokens: m.outImg,
                image_cost: m.cost === null ? null : formatAmount(m.cost),
            })),
        },
    };
}
//# sourceMappingURL=cost.js.map