/**
 * OpenAI Admin API client — the organization usage endpoints the cost
 * assessment needs.
 *
 * Authenticates with an ADMIN key (`sk-admin-…`, created under Organization →
 * Admin keys), a different credential from the project key the image client
 * uses. Read from `OPENAI_ADMIN_KEY`.
 *
 * Endpoints (docs/reference/costs.md, docs/reference/image-costs.md; the
 * completions endpoint's result shape is in costs.md's results union, its
 * query parameters follow the same pattern and were exercised live 2026-09-21):
 *   GET /v1/organization/usage/completions  GPT Image activity (grouped by model)
 *   GET /v1/organization/usage/images       DALL-E-era image activity
 *   GET /v1/organization/costs              amounts; buckets 1d only
 *
 * All three paginate with `page` / `next_page`; every method follows the
 * cursor until `has_more` is false, because a report built from a partial set
 * under-reports silently. Transient failures (429, 5xx, network) are retried
 * with backoff; a 4xx other than 429 is not.
 */
import { type CompletionsUsageResult, type CostAssessment, type CostsResult, type ImagesUsageResult, type UsagePage } from './cost.js';
import type { LogLevel } from './types.js';
/** Admin API endpoint paths, relative to BASE_URL */
export declare const ADMIN_ENDPOINTS: {
    readonly completionsUsage: "/v1/organization/usage/completions";
    readonly imagesUsage: "/v1/organization/usage/images";
    readonly costs: "/v1/organization/costs";
};
/** Usage bucket widths and their limit bounds (docs/reference/image-costs.md) */
export declare const USAGE_LIMITS: {
    readonly '1d': {
        readonly default: 7;
        readonly max: 31;
    };
    readonly '1h': {
        readonly default: 24;
        readonly max: 168;
    };
    readonly '1m': {
        readonly default: 60;
        readonly max: 1440;
    };
};
/** Costs supports daily buckets only; limit 1–180, default 7 (docs/reference/costs.md) */
export declare const COSTS_LIMITS: {
    readonly '1d': {
        readonly default: 7;
        readonly max: 180;
    };
};
export type UsageBucketWidth = keyof typeof USAGE_LIMITS;
export type ImagesGroupBy = 'project_id' | 'user_id' | 'api_key_id' | 'model' | 'size' | 'source';
export type CompletionsGroupBy = 'project_id' | 'user_id' | 'api_key_id' | 'model' | 'batch' | 'service_tier';
export type CostsGroupBy = 'project_id' | 'api_key_id' | 'line_item';
/** Options for the admin client */
export interface AdminAPIOptions {
    /** Admin API key. If omitted, reads OPENAI_ADMIN_KEY */
    adminKey?: string | null;
    /** API base URL (default: https://api.openai.com) */
    baseUrl?: string;
    /** Logging level (default: WARNING) */
    logLevel?: LogLevel;
    /** Per-request timeout in milliseconds (default: 60000) */
    requestTimeout?: number;
    /** Attempts per page for 429 / 5xx / network failures (default: 4, exponential backoff from 1 s) */
    maxAttempts?: number;
}
/** Common query fields for the usage endpoints */
interface UsageQueryBase {
    /** Unix seconds, inclusive. Buckets snap to the UTC day containing it. */
    start_time: number;
    /** Unix seconds, exclusive */
    end_time?: number;
    bucket_width?: UsageBucketWidth;
    /** Buckets per page; bounded per bucket width */
    limit?: number;
    project_ids?: string[];
    api_key_ids?: string[];
    user_ids?: string[];
    models?: string[];
}
/** Query for GET /organization/usage/images */
export interface ImagesUsageQuery extends UsageQueryBase {
    group_by?: ImagesGroupBy[];
    sizes?: string[];
    sources?: Array<'image.generation' | 'image.edit' | 'image.variation'>;
}
/** Query for GET /organization/usage/completions */
export interface CompletionsUsageQuery extends UsageQueryBase {
    group_by?: CompletionsGroupBy[];
    batch?: boolean;
}
/** Query for GET /organization/costs */
export interface CostsQuery {
    start_time: number;
    end_time?: number;
    /** Only '1d' is supported */
    bucket_width?: '1d';
    group_by?: CostsGroupBy[];
    /** Buckets per page, 1–180 */
    limit?: number;
    project_ids?: string[];
    api_key_ids?: string[];
    /** Exact line-item names */
    line_items?: string[];
}
/** Scope filters for a cost assessment */
export interface AssessmentFilters {
    project_ids?: string[];
    api_key_ids?: string[];
}
/**
 * Keep `amount.value` exact. The API emits it as a JSON number with up to 34
 * significant digits; JSON.parse would round it through a double. Quoting the
 * literal before parsing delivers it to cost.ts as a string.
 *
 * @param raw - The response body text
 * @returns The same JSON with every `"value": <number>` literal quoted
 */
export declare function preserveAmountText(raw: string): string;
/**
 * Client for the organization usage endpoints.
 */
export declare class OpenAIAdminAPI {
    private logger;
    private adminKey;
    private baseUrl;
    private requestTimeout;
    private maxAttempts;
    constructor({ adminKey, baseUrl, logLevel, requestTimeout, maxAttempts, }?: AdminAPIOptions);
    /** Translate an axios failure into the package's error vocabulary */
    private _throw;
    /** Whether a failure is worth another attempt */
    private _retryable;
    /** One GET with the admin bearer, retried on transient failure; returns the parsed body after a shape check */
    private _get;
    /**
     * Follow `next_page` until `has_more` is false. Returns every page in order.
     *
     * @param maxPages - Safety stop against a cursor that never ends (default 1000)
     */
    private _allPages;
    private _usageQuery;
    /**
     * All pages of GET /organization/usage/completions. GPT Image models report
     * here (as `gpt-image-*`), alongside every text model the organization used.
     *
     * @param query - Range, bucket width, limit, filters and grouping
     * @returns Every page, in order, the last with `has_more: false`
     * @throws OpenAIImageAPIError For a bad limit (validation_error) or a failed request after retries
     * @example
     * const pages = await admin.listCompletionsUsage({
     *   start_time, end_time, group_by: ['project_id', 'api_key_id', 'model'],
     * });
     */
    listCompletionsUsage(query: CompletionsUsageQuery): Promise<UsagePage<CompletionsUsageResult>[]>;
    /**
     * All pages of GET /organization/usage/images (DALL-E-era image sources).
     *
     * @param query - Range, bucket width, limit, filters and grouping
     * @returns Every page, in order, the last with `has_more: false`
     * @throws OpenAIImageAPIError For a bad limit (validation_error) or a failed request after retries
     * @example
     * const pages = await admin.listImagesUsage({ start_time, end_time, group_by: ['project_id', 'api_key_id', 'model', 'size', 'source'] });
     */
    listImagesUsage(query: ImagesUsageQuery): Promise<UsagePage<ImagesUsageResult>[]>;
    /**
     * All pages of GET /organization/costs (daily buckets only). Amounts arrive
     * as decimal strings (see preserveAmountText).
     *
     * @param query - Range, limit, filters and grouping
     * @returns Every page, in order, the last with `has_more: false`
     * @throws OpenAIImageAPIError For a bad limit (validation_error) or a failed request after retries
     * @example
     * const pages = await admin.listCosts({ start_time, end_time, group_by: ['project_id', 'api_key_id', 'line_item'] });
     */
    listCosts(query: CostsQuery): Promise<UsagePage<CostsResult>[]>;
    /**
     * Fetch all three endpoints over one UTC range with aligned daily buckets and
     * build the assessment.
     *
     * One query per endpoint: completions grouped by project, API key and model
     * (GPT Image activity); images grouped by project, API key, user, model,
     * size and source (DALL-E-era activity); costs grouped by project, API key
     * and line item with no line-item filter, so unmatched spend stays visible.
     *
     * @param range - `start_time` inclusive, `end_time` exclusive, Unix seconds UTC
     * @param filters - Optional project / API-key filters, applied to every call
     * @returns The assessment: one row per UTC day × scope, each with its per-model reconciliation
     * @throws OpenAIImageAPIError For a bad range (validation_error) or any failed request
     * @example
     * const admin = new OpenAIAdminAPI();
     * const report = await admin.assessImageCosts({ start_time, end_time }, { project_ids: ['proj_…'] });
     * for (const row of report.rows) for (const m of row.models) console.log(row.period_start_iso, m.model, m.requests, m.cost.total);
     */
    assessImageCosts(range: {
        start_time: number;
        end_time: number;
    }, filters?: AssessmentFilters): Promise<CostAssessment>;
}
export {};
//# sourceMappingURL=admin-api.d.ts.map