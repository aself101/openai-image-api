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
import axios from 'axios';
import winston from 'winston';
import { BASE_URL } from './config.js';
import { OpenAIImageAPIError, apiErrorBody } from './errors.js';
import { getErrorMessage, toWinstonLevel } from './utils.js';
import { assessImageCosts as assess, } from './cost.js';
/** Admin API endpoint paths, relative to BASE_URL */
export const ADMIN_ENDPOINTS = {
    imagesUsage: '/v1/organization/usage/images',
    costs: '/v1/organization/costs',
};
/** Images-usage bucket widths and their limit bounds (docs/image-costs.md) */
export const IMAGES_USAGE_LIMITS = {
    '1d': { default: 7, max: 31 },
    '1h': { default: 24, max: 168 },
    '1m': { default: 60, max: 1440 },
};
/** Costs supports daily buckets only; limit 1–180, default 7 (docs/costs.md) */
export const COSTS_LIMITS = { '1d': { default: 7, max: 180 } };
/**
 * Client for the organization usage endpoints.
 */
export class OpenAIAdminAPI {
    logger;
    adminKey;
    baseUrl;
    requestTimeout;
    constructor({ adminKey = null, baseUrl = BASE_URL, logLevel = 'WARNING', requestTimeout = 60_000, } = {}) {
        this.logger = winston.createLogger({
            level: toWinstonLevel(logLevel),
            format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => `${String(timestamp)} - ${level.toUpperCase()} - ${String(message)}`)),
            transports: [new winston.transports.Console()],
        });
        if (baseUrl && !baseUrl.startsWith('https://')) {
            throw new OpenAIImageAPIError('API base URL must use HTTPS protocol for security', {
                type: 'configuration_error',
            });
        }
        const key = adminKey ?? process.env.OPENAI_ADMIN_KEY;
        if (!key) {
            throw new OpenAIImageAPIError('OPENAI_ADMIN_KEY not found. The organization usage endpoints need an admin key (Organization → Admin keys), ' +
                'not a project API key. Set OPENAI_ADMIN_KEY or pass { adminKey } to the constructor.', { type: 'configuration_error' });
        }
        this.adminKey = key;
        this.baseUrl = baseUrl;
        this.requestTimeout = requestTimeout;
    }
    /** Redacted key for logs */
    _redacted() {
        return this.adminKey.length < 8 ? '[REDACTED]' : `sk-...${this.adminKey.slice(-4)}`;
    }
    /** Translate an axios failure into the package's error vocabulary */
    _throw(error) {
        if (error instanceof OpenAIImageAPIError)
            throw error;
        this.logger.error(`Admin API request failed: ${getErrorMessage(error)}`);
        const response = error?.response;
        if (response) {
            const body = apiErrorBody(error);
            const details = {
                status: response.status,
                code: body?.code,
                type: body?.type,
                apiMessage: body?.message,
                cause: error,
            };
            if (response.status === 401) {
                throw new OpenAIImageAPIError('Authentication failed. The usage endpoints require an ADMIN key (sk-admin-…), not a project key.', details);
            }
            if (response.status === 403) {
                throw new OpenAIImageAPIError('Access forbidden: the admin key lacks permission for organization usage.', details);
            }
            if (response.status === 429)
                throw new OpenAIImageAPIError('Rate limit exceeded. Please try again later.', details);
            throw new OpenAIImageAPIError(`API error (${response.status}): ${body?.message ?? getErrorMessage(error)}`, details);
        }
        throw new OpenAIImageAPIError(`Request failed: ${getErrorMessage(error)}`, { cause: error });
    }
    /** One GET with the admin bearer; returns the parsed body after a shape check */
    async _get(endpoint, query) {
        const url = `${this.baseUrl}${endpoint}`;
        this.logger.debug(`Admin API request: GET ${endpoint} (${this._redacted()}) ${JSON.stringify(query)}`);
        try {
            const response = await axios.get(url, {
                headers: { Authorization: `Bearer ${this.adminKey}` },
                params: query,
                // repeat array keys: group_by=project_id&group_by=api_key_id
                paramsSerializer: { indexes: null },
                timeout: this.requestTimeout,
                maxContentLength: 64 * 1024 * 1024,
            });
            const body = response.data;
            if (typeof body !== 'object' ||
                body === null ||
                !Array.isArray(body.data) ||
                typeof body.has_more !== 'boolean') {
                throw new OpenAIImageAPIError(`Unexpected response shape from ${endpoint}: expected { data: [], has_more }`, {
                    status: response.status,
                });
            }
            return body;
        }
        catch (error) {
            this._throw(error);
        }
    }
    /**
     * Follow `next_page` until `has_more` is false. Returns every page in order.
     *
     * @param maxPages - Safety stop against a cursor that never ends (default 1000)
     */
    async _allPages(endpoint, query, maxPages = 1000) {
        const pages = [];
        let cursor;
        do {
            const page = await this._get(endpoint, cursor ? { ...query, page: cursor } : query);
            pages.push(page);
            cursor = page.has_more && page.next_page ? page.next_page : undefined;
            if (page.has_more && !page.next_page) {
                throw new OpenAIImageAPIError(`${endpoint}: has_more is true but no next_page cursor was returned`, {
                    type: 'stream_error',
                });
            }
            if (pages.length >= maxPages && cursor) {
                throw new OpenAIImageAPIError(`${endpoint}: more than ${maxPages} pages; refusing to continue`, {
                    type: 'stream_error',
                });
            }
        } while (cursor);
        return pages;
    }
    /**
     * All pages of GET /organization/usage/images.
     *
     * @example
     * const pages = await admin.listImagesUsage({
     *   start_time: 1730419200, end_time: 1731024000,
     *   bucket_width: '1d', group_by: ['project_id', 'api_key_id', 'model', 'size', 'source'],
     * });
     */
    async listImagesUsage(query) {
        const width = query.bucket_width ?? '1d';
        const bounds = IMAGES_USAGE_LIMITS[width];
        const limit = query.limit ?? bounds.max;
        if (limit < 1 || limit > bounds.max) {
            throw new OpenAIImageAPIError(`limit for bucket_width ${width} must be 1–${bounds.max}`, {
                type: 'validation_error',
            });
        }
        return this._allPages(ADMIN_ENDPOINTS.imagesUsage, {
            start_time: query.start_time,
            end_time: query.end_time,
            bucket_width: width,
            limit,
            group_by: query.group_by,
            project_ids: query.project_ids,
            api_key_ids: query.api_key_ids,
            user_ids: query.user_ids,
            models: query.models,
            sizes: query.sizes,
            sources: query.sources,
        });
    }
    /**
     * All pages of GET /organization/costs (daily buckets only).
     *
     * @example
     * const pages = await admin.listCosts({
     *   start_time: 1730419200, end_time: 1731024000,
     *   group_by: ['project_id', 'api_key_id', 'line_item'],
     * });
     */
    async listCosts(query) {
        const limit = query.limit ?? COSTS_LIMITS['1d'].max;
        if (limit < 1 || limit > COSTS_LIMITS['1d'].max) {
            throw new OpenAIImageAPIError(`limit for costs must be 1–${COSTS_LIMITS['1d'].max}`, {
                type: 'validation_error',
            });
        }
        return this._allPages(ADMIN_ENDPOINTS.costs, {
            start_time: query.start_time,
            end_time: query.end_time,
            bucket_width: '1d',
            limit,
            group_by: query.group_by,
            project_ids: query.project_ids,
            api_key_ids: query.api_key_ids,
            line_items: query.line_items,
        });
    }
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
    async assessImageCosts(range, filters = {}) {
        if (!Number.isInteger(range.start_time) ||
            !Number.isInteger(range.end_time) ||
            range.end_time <= range.start_time) {
            throw new OpenAIImageAPIError('range.start_time and range.end_time must be integer Unix seconds with end after start', {
                type: 'validation_error',
            });
        }
        const [imagePages, costPages] = await Promise.all([
            this.listImagesUsage({
                ...range,
                bucket_width: '1d',
                group_by: ['project_id', 'api_key_id', 'user_id', 'model', 'size', 'source'],
                project_ids: filters.project_ids,
                api_key_ids: filters.api_key_ids,
            }),
            this.listCosts({
                ...range,
                group_by: ['project_id', 'api_key_id', 'line_item'],
                project_ids: filters.project_ids,
                api_key_ids: filters.api_key_ids,
            }),
        ]);
        this.logger.info(`Fetched ${imagePages.length} images page(s) and ${costPages.length} costs page(s)`);
        return assess(imagePages, costPages, range);
    }
}
//# sourceMappingURL=admin-api.js.map