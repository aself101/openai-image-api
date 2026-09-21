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
/** A paginated response from any usage endpoint */
export interface UsagePage<R> {
    object: 'page';
    data: UsageBucket<R>[];
    has_more: boolean;
    next_page: string | null;
}
/** One time bucket; `[start_time, end_time)` in Unix seconds */
export interface UsageBucket<R> {
    object: 'bucket';
    start_time: number;
    end_time: number;
    results: R[];
}
/** `organization.usage.images.result` — the DALL-E-era image surface */
export interface ImagesUsageResult {
    object: 'organization.usage.images.result';
    images: number;
    num_model_requests: number;
    project_id?: string | null;
    user_id?: string | null;
    api_key_id?: string | null;
    model?: string | null;
    size?: string | null;
    /** `image.generation`, `image.edit`, or `image.variation` */
    source?: string | null;
}
/** `organization.usage.completions.result` — where GPT Image activity is reported */
export interface CompletionsUsageResult {
    object: 'organization.usage.completions.result';
    input_tokens: number;
    output_tokens: number;
    num_model_requests: number;
    project_id?: string | null;
    user_id?: string | null;
    api_key_id?: string | null;
    model?: string | null;
    batch?: boolean | null;
    service_tier?: string | null;
    input_text_tokens?: number | null;
    input_image_tokens?: number | null;
    input_audio_tokens?: number | null;
    input_cached_tokens?: number | null;
    input_cached_text_tokens?: number | null;
    input_cached_image_tokens?: number | null;
    input_cache_write_tokens?: number | null;
    output_text_tokens?: number | null;
    output_image_tokens?: number | null;
    output_audio_tokens?: number | null;
}
/** Units the Costs endpoint documents for `quantity` */
export type CostQuantityUnit = 'tokens' | '1000_tokens' | 'duration_seconds' | 'duration_minutes' | 'duration_hours' | 'gibibyte_hours' | 'images' | 'characters';
/** `organization.costs.result` */
export interface CostsResult {
    object: 'organization.costs.result';
    /**
     * `value` is a JSON number on the wire with up to 34 significant digits.
     * OpenAIAdminAPI preserves it as a string before JSON.parse so no precision
     * is lost; a number is accepted for fixtures and other callers.
     */
    amount?: {
        currency?: string | null;
        value?: number | string | null;
    } | null;
    api_key_id?: string | null;
    line_item?: string | null;
    project_id?: string | null;
    quantity?: number | null;
    /** One of CostQuantityUnit when documented; the schema allows other strings */
    quantity_unit?: string | null;
}
/** Any result the three endpoints can return; unrelated types are skipped */
export type AnyUsageResult = ImagesUsageResult | CompletionsUsageResult | CostsResult | {
    object: string;
};
/** Decimal places every amount is held at (1 unit = 1e-12 of the currency) */
export declare const AMOUNT_SCALE = 12;
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
export declare function toScaled(value: number | string): bigint;
/**
 * Render a scaled amount as a decimal string: at least two decimals, trailing
 * zeros beyond that trimmed, at most `maxDecimals` (truncated, not rounded).
 *
 * @param scaled - An integer at AMOUNT_SCALE decimal places, as from toScaled
 * @param maxDecimals - Decimal places to keep (default AMOUNT_SCALE)
 * @returns Decimal text, e.g. `0.06549`, `1.00`, `-0.05`
 */
export declare function formatAmount(scaled: bigint, maxDecimals?: number): string;
/** An amount in one currency */
export interface Money {
    currency: string;
    scaled: bigint;
}
export type LineItemClass = 'image_generation' | 'other_known' | 'unknown';
export type CostComponent = 'input' | 'cached input' | 'output';
export type CostModality = 'image' | 'text';
/** A line item of the form `<model> <modality>, <component>` */
export interface ParsedLineItem {
    model: string;
    modality: CostModality;
    component: CostComponent;
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
export declare function parseLineItem(lineItem: string | null | undefined): ParsedLineItem | null;
/** Model-id prefixes that denote image models */
export declare const IMAGE_MODEL_PREFIXES: readonly string[];
/**
 * Whether a model id is an image model by prefix.
 *
 * @param model - Model id as either endpoint names it
 * @returns True for `gpt-image-*`, `dall-e-*`, `chatgpt-image*`
 */
export declare const isImageModel: (model: string) => boolean;
/**
 * Exact `line_item` strings known to be image spend without parsing. Empty:
 * every observed image line item parses. Kept for a vocabulary that may not.
 * Bump LINE_ITEM_CLASSIFIER_VERSION when either list or the parser changes.
 */
export declare const IMAGE_LINE_ITEMS: ReadonlySet<string>;
export declare const OTHER_KNOWN_LINE_ITEMS: ReadonlySet<string>;
export declare const LINE_ITEM_CLASSIFIER_VERSION = "2026-09-21.2";
/**
 * Classify one cost row. Signals, in order: a documented `quantity_unit` of
 * `images`; a parsed `<model> …` line item whose model is an image model; an
 * exact-match list. Everything else is `unknown` and stays visible.
 *
 * @param row - The Costs row's `line_item` and `quantity_unit`
 * @returns `image_generation`, `other_known`, or `unknown`
 */
export declare function classifyCostRow(row: Pick<CostsResult, 'line_item' | 'quantity_unit'>): LineItemClass;
/**
 * Model family: the id with a trailing `-YYYY-MM-DD` snapshot removed. Costs
 * said `gpt-image-1` where usage said `gpt-image-1-2025-04-23` for the same
 * activity; the two sides match exactly first, then by family.
 *
 * @param model - Model id
 * @returns The id without a trailing snapshot date
 */
export declare const modelFamily: (model: string) => string;
/**
 * Sentinel for an absent optional dimension. U+2400 (␀, "symbol for null") is
 * not ASCII, so it cannot collide with any project, key, user or model id, and
 * it is valid text everywhere a NUL byte would not be (Postgres `text`, JSON).
 * AssessmentRow output renders it as null; only the exported normalize*
 * intermediates carry it.
 */
export declare const UNKNOWN = "\u2400UNKNOWN";
export type Dim = string;
export interface BucketKey {
    start_time: number;
    end_time: number;
}
/** The scope both endpoints can express: project × API key */
export interface ScopeKey {
    project_id: Dim;
    api_key_id: Dim;
}
/** Provenance: [endpoint, page, bucket, result] */
export type Provenance = [endpoint: 'images' | 'completions' | 'costs', page: number, bucket: number, result: number];
/** One activity result from either usage endpoint, normalized */
export interface ActivityRow {
    bucket: BucketKey;
    scope: ScopeKey;
    source: 'images' | 'completions';
    model: Dim;
    user_id: Dim;
    requests: number;
    /** Image count — only the images endpoint reports one */
    images: number | null;
    input_text_tokens: number;
    input_image_tokens: number;
    input_cached_tokens: number;
    output_text_tokens: number;
    output_image_tokens: number;
    /** images endpoint: size and source of the activity */
    size: Dim;
    image_source: Dim;
    provenance: Provenance;
}
/** One Costs result, normalized and classified */
export interface CostRow {
    bucket: BucketKey;
    scope: ScopeKey;
    line_item: Dim;
    parsed: ParsedLineItem | null;
    classification: LineItemClass;
    amount: Money | null;
    quantity: number | null;
    quantity_unit: string | null;
    provenance: Provenance;
}
export interface SkippedRow {
    endpoint: 'images' | 'completions' | 'costs';
    object: string;
    provenance: Provenance;
}
/**
 * Normalize Images-usage pages.
 *
 * @param pages - Every page of ONE images-usage query, in order
 * @returns Activity rows (source `images`) and the results of other types that were skipped
 * @throws Error When the page set is incomplete or has a gap
 */
export declare function normalizeImages(pages: UsagePage<AnyUsageResult>[]): {
    rows: ActivityRow[];
    skipped: SkippedRow[];
};
/**
 * Normalize Completions-usage pages, keeping only image-model rows (the
 * endpoint also reports every text model the organization used). The count
 * of dropped non-image rows is returned so the report can say so.
 *
 * @param pages - Every page of ONE completions-usage query, in order
 * @returns Activity rows (source `completions`), skipped results, and the number of non-image-model rows dropped
 * @throws Error When the page set is incomplete or has a gap
 */
export declare function normalizeCompletions(pages: UsagePage<AnyUsageResult>[]): {
    rows: ActivityRow[];
    skipped: SkippedRow[];
    nonImageModelRows: number;
};
/**
 * Normalize Costs pages: exact-decimal amounts, lowercase currency, parsed and classified line items.
 *
 * @param pages - Every page of ONE costs query, in order
 * @returns Cost rows and the results of other types that were skipped
 * @throws Error When the page set is incomplete or has a gap; TypeError when an amount is not a decimal
 */
export declare function normalizeCosts(pages: UsagePage<AnyUsageResult>[]): {
    rows: CostRow[];
    skipped: SkippedRow[];
};
export type ScopeLevel = 'organization' | 'project' | 'api_key' | 'project_api_key';
export type AttributionLevel = 'exact_scope_reconciliation' | 'image_line_item_reconciliation' | 'shared_scope_estimate' | 'unattributed';
/** How a model's cost rows were matched to its activity rows */
export type ModelMatch = 'exact' | 'family' | 'cost_only' | 'activity_only';
/** Cost per component for one model at one scope and day */
export interface ModelCostBreakdown {
    image_input: string | null;
    image_cached_input: string | null;
    image_output: string | null;
    text_input: string | null;
    text_cached_input: string | null;
    text_output: string | null;
    /** Sum of every image-classified row for this model */
    total: string | null;
}
/** Token counts the cost side reported as `quantity`, per component */
export type ModelCostQuantities = Record<Exclude<keyof ModelCostBreakdown, 'total'>, number | null>;
/** One model at one scope and day: activity, cost, and how they line up */
export interface ModelAssessment {
    /** Model id as the cost side names it, else as the usage side names it */
    model: string;
    /** Model id as the usage side names it, when present */
    activity_model: string | null;
    family: string;
    match: ModelMatch;
    requests: number | null;
    /** From the images endpoint only; completions does not report an image count */
    images: number | null;
    input_text_tokens: number | null;
    input_image_tokens: number | null;
    input_cached_tokens: number | null;
    output_text_tokens: number | null;
    output_image_tokens: number | null;
    cost: ModelCostBreakdown;
    cost_quantities: ModelCostQuantities;
    currency: string | null;
    /** cost.total / requests, when both present */
    average_cost_per_request: string | null;
    /** cost.total / images, only when the images endpoint supplied a count */
    average_cost_per_image: string | null;
    /**
     * Whether usage token counts equal the cost-side quantities, component by
     * component, where both are present; null when one side is absent.
     */
    tokens_reconcile: boolean | null;
    warnings: string[];
}
/** One line of the assessment: a bucket × a scope */
export interface AssessmentRow {
    period_start: number;
    period_end: number;
    period_start_iso: string;
    period_end_iso: string;
    /** True when the bucket extends past the requested range end (a partial day) */
    partial: boolean;
    scope: ScopeLevel;
    project_id: string | null;
    api_key_id: string | null;
    /** Model requests from either usage endpoint (image models only); null when no activity rows */
    image_request_count: number | null;
    /** Image count from the images endpoint; null when it reported nothing */
    image_count: number | null;
    output_image_tokens: number | null;
    input_image_tokens: number | null;
    classified_image_cost: string | null;
    unclassified_cost: string | null;
    other_known_cost: string | null;
    /** Every cost row at this scope in the scope currency — all API products, not only images */
    total_cost: string | null;
    currency: string | null;
    /** Rows in a currency other than the scope currency, excluded from every total above */
    excluded_foreign_currency: Array<{
        currency: string;
        amount: string;
        line_item: string | null;
    }>;
    /** classified_image_cost / image_count, only at an exact scope with both present */
    average_cost_per_image: string | null;
    /** classified_image_cost / image_request_count, only at an exact scope with both present */
    average_cost_per_request: string | null;
    image_cost_coverage: number | null;
    attribution_level: AttributionLevel;
    warnings: string[];
    models: ModelAssessment[];
    line_items: Array<{
        line_item: string | null;
        classification: LineItemClass;
        amount: string | null;
        currency: string | null;
        quantity: number | null;
        quantity_unit: string | null;
    }>;
    /** images-endpoint breakdown (size / source / user), for display only */
    image_breakdown: Array<{
        model: string | null;
        size: string | null;
        source: string | null;
        user_id: string | null;
        images: number;
        requests: number;
    }>;
    provenance: Provenance[];
}
export interface CostAssessment {
    range: {
        start_time: number;
        end_time: number;
    };
    classifier_version: string;
    rows: AssessmentRow[];
    warnings: string[];
    /** Every distinct line_item string observed, for auditing the classifier */
    observed_line_items: string[];
    /** Every distinct image model id observed on either side */
    observed_models: string[];
    totals: {
        image_request_count: number;
        image_count: number | null;
        output_image_tokens: number;
        by_currency: Array<{
            currency: string;
            classified_image_cost: string;
            unclassified_cost: string;
            other_known_cost: string;
            total_cost: string;
        }>;
        /** Image-classified cost per model family across the whole range, per currency; null cost when the family had no cost rows */
        by_model: Array<{
            family: string;
            currency: string | null;
            requests: number;
            output_image_tokens: number;
            image_cost: string | null;
        }>;
    };
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
export declare function assessImageCosts(imagePages: UsagePage<AnyUsageResult>[], completionPages: UsagePage<AnyUsageResult>[], costPages: UsagePage<AnyUsageResult>[], range: {
    start_time: number;
    end_time: number;
}): CostAssessment;
//# sourceMappingURL=cost.d.ts.map