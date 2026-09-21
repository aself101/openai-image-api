/**
 * OpenAI Admin API client — the two organization usage endpoints the cost
 * assessment needs.
 *
 * Authenticates with an ADMIN key (`sk-admin-…`, created under Organization →
 * Admin keys), which is a different credential from the project key the image
 * client uses. Read from `OPENAI_ADMIN_KEY`.
 *
 * Endpoints (docs/costs.md, docs/image-costs.md):
 *   GET /v1/organization/usage/images   activity counts; buckets 1m/1h/1d
 *   GET /v1/organization/costs          dollar amounts; buckets 1d only
 *
 * Both paginate with `page` / `next_page`; every method here follows the
 * cursor until `has_more` is false and returns the complete page set, because
 * a report built from a partial set under-reports silently.
 */
import { type CostAssessment, type CostsResult, type ImagesUsageResult, type UsagePage } from './cost.js';
import type { LogLevel } from './types.js';
/** Admin API endpoint paths, relative to BASE_URL */
export declare const ADMIN_ENDPOINTS: {
    readonly imagesUsage: "/v1/organization/usage/images";
    readonly costs: "/v1/organization/costs";
};
/** Images-usage bucket widths and their limit bounds (docs/image-costs.md) */
export declare const IMAGES_USAGE_LIMITS: {
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
/** Costs supports daily buckets only; limit 1–180, default 7 (docs/costs.md) */
export declare const COSTS_LIMITS: {
    readonly '1d': {
        readonly default: 7;
        readonly max: 180;
    };
};
export type ImagesBucketWidth = keyof typeof IMAGES_USAGE_LIMITS;
export type ImagesGroupBy = 'project_id' | 'user_id' | 'api_key_id' | 'model' | 'size' | 'source';
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
}
/** Query for GET /organization/usage/images */
export interface ImagesUsageQuery {
    /** Unix seconds, inclusive */
    start_time: number;
    /** Unix seconds, exclusive */
    end_time?: number;
    bucket_width?: ImagesBucketWidth;
    group_by?: ImagesGroupBy[];
    /** Buckets per page; bounded per bucket width */
    limit?: number;
    project_ids?: string[];
    api_key_ids?: string[];
    user_ids?: string[];
    models?: string[];
    sizes?: string[];
    sources?: Array<'image.generation' | 'image.edit' | 'image.variation'>;
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
 * Client for the organization usage endpoints.
 */
export declare class OpenAIAdminAPI {
    private logger;
    private adminKey;
    private baseUrl;
    private requestTimeout;
    constructor({ adminKey, baseUrl, logLevel, requestTimeout, }?: AdminAPIOptions);
    /** Redacted key for logs */
    private _redacted;
    /** Translate an axios failure into the package's error vocabulary */
    private _throw;
    /** One GET with the admin bearer; returns the parsed body after a shape check */
    private _get;
    /**
     * Follow `next_page` until `has_more` is false. Returns every page in order.
     *
     * @param maxPages - Safety stop against a cursor that never ends (default 1000)
     */
    private _allPages;
    /**
     * All pages of GET /organization/usage/images.
     *
     * @example
     * const pages = await admin.listImagesUsage({
     *   start_time: 1730419200, end_time: 1731024000,
     *   bucket_width: '1d', group_by: ['project_id', 'api_key_id', 'model', 'size', 'source'],
     * });
     */
    listImagesUsage(query: ImagesUsageQuery): Promise<UsagePage<ImagesUsageResult>[]>;
    /**
     * All pages of GET /organization/costs (daily buckets only).
     *
     * @example
     * const pages = await admin.listCosts({
     *   start_time: 1730419200, end_time: 1731024000,
     *   group_by: ['project_id', 'api_key_id', 'line_item'],
     * });
     */
    listCosts(query: CostsQuery): Promise<UsagePage<CostsResult>[]>;
    /**
     * Fetch both endpoints over one UTC range with aligned daily buckets and
     * build the assessment.
     *
     * Images are requested in ONE query grouped by project, API key, user,
     * model, size and source, so scope totals and the display breakdown come
     * from the same complete result and nothing is counted twice. Costs are
     * grouped by project, API key and line item; no line-item filter is applied,
     * so unmatched spend stays visible.
     *
     * @param range - `start_time` inclusive, `end_time` exclusive, Unix seconds UTC
     * @param filters - Optional project / API-key filters, applied to both calls
     * @example
     * const admin = new OpenAIAdminAPI();
     * const report = await admin.assessImageCosts({ start_time, end_time }, { project_ids: ['proj_…'] });
     * for (const row of report.rows) console.log(row.period_start_iso, row.scope, row.image_count, row.classified_image_cost);
     */
    assessImageCosts(range: {
        start_time: number;
        end_time: number;
    }, filters?: AssessmentFilters): Promise<CostAssessment>;
}
//# sourceMappingURL=admin-api.d.ts.map