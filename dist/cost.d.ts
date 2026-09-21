/**
 * OpenAI Image Cost Assessment — the reconciliation algorithm.
 *
 * Combines the organization Images-usage endpoint (activity counts) and the
 * Costs endpoint (dollar amounts) into a per-day, per-scope report. This is a
 * reconciliation, not request-level billing: the two endpoints share no
 * request id, and Costs cannot be grouped by model. Everything here preserves
 * the line between what was measured and what would merely be inferred:
 *
 * - Scopes join only where both sides carry the same KNOWN project / API-key
 *   ids. `null` never matches a known id; an all-null row is organization
 *   scope, not "every project".
 * - A cost row counts as image spend only on a documented signal: its
 *   `quantity_unit` is `images`, or its `line_item` is in the versioned
 *   exact-match list below. Temporal co-occurrence with image activity is not
 *   a signal. Unknown line items stay visible as `unclassified_cost`.
 * - Money is summed in integer micro-units (1e-6 of the currency unit), never
 *   as binary floating point, and currencies are never mixed.
 * - Every aggregate keeps the source rows it was built from.
 *
 * Pure: no I/O. `OpenAIAdminAPI` (admin-api.ts) fetches the pages; this module
 * turns them into an assessment. The spec this implements is
 * docs/openai-image-cost-assessment-spec.md.
 */
/** A paginated response from either usage endpoint */
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
/** `organization.usage.images.result` */
export interface ImagesUsageResult {
    object: 'organization.usage.images.result';
    /** The number of images processed */
    images: number;
    /** The count of requests made to the model */
    num_model_requests: number;
    project_id?: string | null;
    user_id?: string | null;
    api_key_id?: string | null;
    model?: string | null;
    size?: string | null;
    /** `image.generation`, `image.edit`, or `image.variation` */
    source?: string | null;
}
/** Units the Costs endpoint documents for `quantity` */
export type CostQuantityUnit = 'tokens' | '1000_tokens' | 'duration_seconds' | 'duration_minutes' | 'duration_hours' | 'gibibyte_hours' | 'images' | 'characters';
/** `organization.costs.result` */
export interface CostsResult {
    object: 'organization.costs.result';
    amount?: {
        currency?: string | null;
        value?: number | null;
    } | null;
    api_key_id?: string | null;
    line_item?: string | null;
    project_id?: string | null;
    quantity?: number | null;
    /** One of CostQuantityUnit when documented; the schema allows other strings */
    quantity_unit?: string | null;
}
/** Micro-units per whole currency unit (6 decimals) */
export declare const MICRO = 1000000n;
/**
 * Convert the API's decimal `value` (a JSON number) to integer micro-units.
 *
 * The API delivers amounts as JSON numbers, which JavaScript has already
 * parsed to binary doubles by the time we see them. Rounding each row to six
 * decimals recovers the decimal the API meant (0.06 → 60000, not
 * 60000.00000000001) and everything after that is integer arithmetic, so a
 * sum over thousands of rows has no drift. [VERIFY: the API never emits more
 * than six decimals — none observed; if it does, the sixth-decimal rounding
 * is the only lossy step and it is per row, not cumulative.]
 */
export declare function toMicro(value: number): bigint;
/** Render micro-units as a decimal string with `decimals` places (default 6, trailing zeros trimmed to at least 2) */
export declare function formatMicro(micro: bigint, decimals?: number): string;
/** An amount in one currency */
export interface Money {
    /** Lowercase ISO-4217 code */
    currency: string;
    /** Integer micro-units */
    micro: bigint;
}
/** How a cost row was classified */
export type LineItemClass = 'image_generation' | 'other_known' | 'unknown';
/**
 * Exact `line_item` strings known to be image-generation spend.
 *
 * Empty at 3.1.0: the reference does not publish the vocabulary and none has
 * been observed against a live organization yet. Rows are still classified
 * as image spend when `quantity_unit === 'images'`, which the schema
 * documents. Add values here only after they have been seen in real output,
 * and bump LINE_ITEM_CLASSIFIER_VERSION.
 */
export declare const IMAGE_LINE_ITEMS: ReadonlySet<string>;
/** Exact `line_item` strings known NOT to be image spend (for display) */
export declare const OTHER_KNOWN_LINE_ITEMS: ReadonlySet<string>;
/** Bump whenever either list changes; recorded in every assessment */
export declare const LINE_ITEM_CLASSIFIER_VERSION = "2026-09-21.1";
/**
 * Classify one cost row. Conservative by construction: only documented or
 * exact-match signals produce `image_generation`; everything else is
 * `unknown` and stays visible as unclassified spend.
 */
export declare function classifyCostRow(row: Pick<CostsResult, 'line_item' | 'quantity_unit'>): LineItemClass;
/**
 * Sentinel for an absent optional dimension. Contains a NUL byte, which no
 * project, key, user or model id can, so it is distinct from every real value
 * while still being a plain string (map keys, template literals).
 */
export declare const UNKNOWN = "\0UNKNOWN";
/** A dimension value: a real id, or UNKNOWN */
export type Dim = string;
/** Bucket boundaries in Unix seconds */
export interface BucketKey {
    start_time: number;
    end_time: number;
}
/** The scope both endpoints can express: project × API key */
export interface ScopeKey {
    project_id: Dim;
    api_key_id: Dim;
}
/** One Images-usage result, normalized, with its bucket and provenance */
export interface ImageRow {
    bucket: BucketKey;
    scope: ScopeKey;
    user_id: Dim;
    model: Dim;
    size: Dim;
    source: Dim;
    images: number;
    requests: number;
    /** Index into the pages array this row came from (page, bucket, result) */
    provenance: [page: number, bucket: number, result: number];
}
/** One Costs result, normalized, classified, with provenance */
export interface CostRow {
    bucket: BucketKey;
    scope: ScopeKey;
    line_item: Dim;
    classification: LineItemClass;
    amount: Money | null;
    quantity: number | null;
    quantity_unit: string | null;
    provenance: [page: number, bucket: number, result: number];
}
/** Rows that were not the expected result type, kept for the report */
export interface SkippedRow {
    endpoint: 'images' | 'costs';
    object: string;
    provenance: [page: number, bucket: number, result: number];
}
/** Normalize Images pages. Throws if a page is incomplete (has_more without a next page fetched). */
export declare function normalizeImages(pages: UsagePage<ImagesUsageResult | {
    object: string;
}>[]): {
    rows: ImageRow[];
    skipped: SkippedRow[];
};
/** Normalize Costs pages. Amounts become micro-units; currency lowercased. */
export declare function normalizeCosts(pages: UsagePage<CostsResult | {
    object: string;
}>[]): {
    rows: CostRow[];
    skipped: SkippedRow[];
};
/** Which scope a row describes */
export type ScopeLevel = 'organization' | 'project' | 'api_key' | 'project_api_key';
/** How confidently image spend was tied to image activity at this scope */
export type AttributionLevel = 'exact_scope_reconciliation' | 'image_line_item_reconciliation' | 'shared_scope_estimate' | 'unattributed';
/** One line of the assessment: a bucket × a scope */
export interface AssessmentRow {
    period_start: number;
    period_end: number;
    /** ISO-8601 UTC renderings of the period */
    period_start_iso: string;
    period_end_iso: string;
    scope: ScopeLevel;
    project_id: string | null;
    api_key_id: string | null;
    image_count: number | null;
    image_request_count: number | null;
    /** Sum of cost rows classified image_generation, or null when none */
    classified_image_cost: string | null;
    /** Sum of unknown-line-item rows, or null when none */
    unclassified_cost: string | null;
    /** Sum of other_known rows, or null when none */
    other_known_cost: string | null;
    /** Sum of every cost row at this scope — all API products, not only images */
    total_cost: string | null;
    currency: string | null;
    /** classified_image_cost / image_count, only at an exact scope with both present */
    average_cost_per_image: string | null;
    /** classified_image_cost / total_cost, when total is positive */
    image_cost_coverage: number | null;
    attribution_level: AttributionLevel;
    warnings: string[];
    /** The line items seen at this scope, with their classification and amount */
    line_items: Array<{
        line_item: string | null;
        classification: LineItemClass;
        amount: string | null;
        quantity: number | null;
        quantity_unit: string | null;
    }>;
    /** Images breakdown at this scope (model / size / source / user), for display only */
    image_breakdown: Array<{
        model: string | null;
        size: string | null;
        source: string | null;
        user_id: string | null;
        images: number;
        requests: number;
    }>;
    /** Source rows this line was built from: [page, bucket, result] indexes into the input pages */
    provenance: {
        images: Array<[number, number, number]>;
        costs: Array<[number, number, number]>;
    };
}
/** The whole report */
export interface CostAssessment {
    /** Inclusive start / exclusive end the caller requested, Unix seconds */
    range: {
        start_time: number;
        end_time: number;
    };
    classifier_version: string;
    rows: AssessmentRow[];
    /** Report-level warnings (skipped result types, empty endpoints, …) */
    warnings: string[];
    /** Every distinct line_item string observed, for promoting into the classifier */
    observed_line_items: string[];
    totals: {
        image_count: number;
        image_request_count: number;
        /** Per-currency totals; never summed across currencies */
        by_currency: Array<{
            currency: string;
            classified_image_cost: string;
            unclassified_cost: string;
            other_known_cost: string;
            total_cost: string;
        }>;
    };
}
/**
 * Build the assessment from complete page sets.
 *
 * `imagePages` must come from ONE Images query grouped by `project_id` and
 * `api_key_id` (plus any of user/model/size/source for display); its rows are
 * summed to the shared scope exactly once. Never pass the union of two
 * differently-grouped Images queries — that double counts. `costPages` must
 * come from one Costs query grouped by `project_id`, `api_key_id`, `line_item`.
 */
export declare function assessImageCosts(imagePages: UsagePage<ImagesUsageResult | {
    object: string;
}>[], costPages: UsagePage<CostsResult | {
    object: string;
}>[], range: {
    start_time: number;
    end_time: number;
}): CostAssessment;
//# sourceMappingURL=cost.d.ts.map