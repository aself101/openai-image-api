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

import axios, { type AxiosResponse } from 'axios';
import { BASE_URL } from './config.js';
import { OpenAIImageAPIError, apiErrorBody } from './errors.js';
import { assertHttpsBaseUrl, createPackageLogger, getErrorMessage, redactKey } from './utils.js';
import {
  assessImageCosts as assess,
  type CompletionsUsageResult,
  type CostAssessment,
  type CostsResult,
  type ImagesUsageResult,
  type UsagePage,
} from './cost.js';
import type { LogLevel, Logger } from './types.js';

/** Admin API endpoint paths, relative to BASE_URL */
export const ADMIN_ENDPOINTS = {
  completionsUsage: '/v1/organization/usage/completions',
  imagesUsage: '/v1/organization/usage/images',
  costs: '/v1/organization/costs',
} as const satisfies Record<string, string>;

/** Usage bucket widths and their limit bounds (docs/reference/image-costs.md) */
export const USAGE_LIMITS = {
  '1d': { default: 7, max: 31 },
  '1h': { default: 24, max: 168 },
  '1m': { default: 60, max: 1440 },
} as const;

/** Costs supports daily buckets only; limit 1–180, default 7 (docs/reference/costs.md) */
export const COSTS_LIMITS = { '1d': { default: 7, max: 180 } } as const;

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

/** Query-string shape axios will serialize; arrays repeat the key */
type Query = Record<string, string | number | boolean | string[] | undefined>;

/**
 * Keep `amount.value` exact. The API emits it as a JSON number with up to 34
 * significant digits; JSON.parse would round it through a double. Quoting the
 * literal before parsing delivers it to cost.ts as a string.
 *
 * @param raw - The response body text
 * @returns The same JSON with every `"value": <number>` literal quoted
 */
export function preserveAmountText(raw: string): string {
  return raw.replace(/("value"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g, '$1"$2"');
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND']);

/**
 * Client for the organization usage endpoints.
 */
export class OpenAIAdminAPI {
  private logger: Logger;
  private adminKey: string;
  private baseUrl: string;
  private requestTimeout: number;
  private maxAttempts: number;

  constructor({
    adminKey = null,
    baseUrl = BASE_URL,
    logLevel = 'WARNING',
    requestTimeout = 60_000,
    maxAttempts = 4,
  }: AdminAPIOptions = {}) {
    this.logger = createPackageLogger(logLevel);
    try {
      assertHttpsBaseUrl(baseUrl);
    } catch (error) {
      throw new OpenAIImageAPIError(getErrorMessage(error), { type: 'configuration_error' });
    }
    const key = adminKey ?? process.env.OPENAI_ADMIN_KEY;
    if (!key) {
      throw new OpenAIImageAPIError(
        'OPENAI_ADMIN_KEY not found. The organization usage endpoints need an admin key (Organization → Admin keys), ' +
          'not a project API key. Set OPENAI_ADMIN_KEY or pass { adminKey } to the constructor.',
        { type: 'configuration_error' }
      );
    }
    this.adminKey = key;
    this.baseUrl = baseUrl;
    this.requestTimeout = requestTimeout;
    this.maxAttempts = Math.max(1, maxAttempts);
  }

  /** Translate an axios failure into the package's error vocabulary */
  private _throw(error: unknown): never {
    if (error instanceof OpenAIImageAPIError) throw error;
    this.logger.error(`Admin API request failed: ${getErrorMessage(error)}`);
    const response = (error as { response?: { status: number } } | null)?.response;
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
        throw new OpenAIImageAPIError(
          'Authentication failed. The usage endpoints require an ADMIN key (sk-admin-…), not a project key.',
          details
        );
      }
      if (response.status === 403)
        throw new OpenAIImageAPIError(
          'Access forbidden: the admin key lacks permission for organization usage.',
          details
        );
      if (response.status === 429)
        throw new OpenAIImageAPIError('Rate limit exceeded after retries. Please try again later.', details);
      throw new OpenAIImageAPIError(
        `API error (${response.status}): ${body?.message ?? getErrorMessage(error)}`,
        details
      );
    }
    throw new OpenAIImageAPIError(`Request failed: ${getErrorMessage(error)}`, { cause: error });
  }

  /** Whether a failure is worth another attempt */
  private _retryable(error: unknown): boolean {
    const e = error as { response?: { status?: number }; code?: string } | null;
    if (e?.response?.status !== undefined) return RETRYABLE_STATUSES.has(e.response.status);
    return typeof e?.code === 'string' && RETRYABLE_CODES.has(e.code);
  }

  /** One GET with the admin bearer, retried on transient failure; returns the parsed body after a shape check */
  private async _get<R>(endpoint: string, query: Query): Promise<UsagePage<R>> {
    const url = `${this.baseUrl}${endpoint}`;
    this.logger.debug(`Admin API request: GET ${endpoint} (${redactKey(this.adminKey)}) ${JSON.stringify(query)}`);
    for (let attempt = 1; ; attempt++) {
      try {
        const response: AxiosResponse<unknown> = await axios.get(url, {
          headers: { Authorization: `Bearer ${this.adminKey}` },
          params: query,
          // repeat array keys: group_by=project_id&group_by=api_key_id
          paramsSerializer: { indexes: null },
          timeout: this.requestTimeout,
          maxContentLength: 64 * 1024 * 1024,
          // keep amount.value exact; see preserveAmountText
          transformResponse: [
            (data: unknown) => (typeof data === 'string' ? (JSON.parse(preserveAmountText(data)) as unknown) : data),
          ],
        });
        const body = response.data;
        if (
          typeof body !== 'object' ||
          body === null ||
          !Array.isArray((body as { data?: unknown }).data) ||
          typeof (body as { has_more?: unknown }).has_more !== 'boolean'
        ) {
          throw new OpenAIImageAPIError(`Unexpected response shape from ${endpoint}: expected { data: [], has_more }`, {
            status: response.status,
          });
        }
        return body as UsagePage<R>;
      } catch (error) {
        if (attempt < this.maxAttempts && this._retryable(error)) {
          const delay = 1000 * 2 ** (attempt - 1);
          this.logger.warn(
            `Admin API ${endpoint}: attempt ${attempt} failed (${getErrorMessage(error)}); retrying in ${delay}ms`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        this._throw(error);
      }
    }
  }

  /**
   * Follow `next_page` until `has_more` is false. Returns every page in order.
   *
   * @param maxPages - Safety stop against a cursor that never ends (default 1000)
   */
  private async _allPages<R>(endpoint: string, query: Query, maxPages: number = 1000): Promise<UsagePage<R>[]> {
    const pages: UsagePage<R>[] = [];
    let cursor: string | undefined;
    do {
      const page = await this._get<R>(endpoint, cursor ? { ...query, page: cursor } : query);
      pages.push(page);
      if (page.has_more && !page.next_page) {
        throw new OpenAIImageAPIError(`${endpoint}: has_more is true but no next_page cursor was returned`, {
          type: 'stream_error',
        });
      }
      cursor = page.has_more && page.next_page ? page.next_page : undefined;
      if (pages.length >= maxPages && cursor) {
        throw new OpenAIImageAPIError(`${endpoint}: more than ${maxPages} pages; refusing to continue`, {
          type: 'stream_error',
        });
      }
    } while (cursor);
    return pages;
  }

  private _usageQuery(query: UsageQueryBase, extra: Query): Query {
    const width = query.bucket_width ?? '1d';
    const bounds = USAGE_LIMITS[width];
    const limit = query.limit ?? bounds.max;
    if (limit < 1 || limit > bounds.max) {
      throw new OpenAIImageAPIError(`limit for bucket_width ${width} must be 1–${bounds.max}`, {
        type: 'validation_error',
      });
    }
    return {
      start_time: query.start_time,
      end_time: query.end_time,
      bucket_width: width,
      limit,
      project_ids: query.project_ids,
      api_key_ids: query.api_key_ids,
      user_ids: query.user_ids,
      models: query.models,
      ...extra,
    };
  }

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
  async listCompletionsUsage(query: CompletionsUsageQuery): Promise<UsagePage<CompletionsUsageResult>[]> {
    return this._allPages<CompletionsUsageResult>(
      ADMIN_ENDPOINTS.completionsUsage,
      this._usageQuery(query, { group_by: query.group_by, batch: query.batch })
    );
  }

  /**
   * All pages of GET /organization/usage/images (DALL-E-era image sources).
   *
   * @param query - Range, bucket width, limit, filters and grouping
   * @returns Every page, in order, the last with `has_more: false`
   * @throws OpenAIImageAPIError For a bad limit (validation_error) or a failed request after retries
   * @example
   * const pages = await admin.listImagesUsage({ start_time, end_time, group_by: ['project_id', 'api_key_id', 'model', 'size', 'source'] });
   */
  async listImagesUsage(query: ImagesUsageQuery): Promise<UsagePage<ImagesUsageResult>[]> {
    return this._allPages<ImagesUsageResult>(
      ADMIN_ENDPOINTS.imagesUsage,
      this._usageQuery(query, { group_by: query.group_by, sizes: query.sizes, sources: query.sources })
    );
  }

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
  async listCosts(query: CostsQuery): Promise<UsagePage<CostsResult>[]> {
    const limit = query.limit ?? COSTS_LIMITS['1d'].max;
    if (limit < 1 || limit > COSTS_LIMITS['1d'].max) {
      throw new OpenAIImageAPIError(`limit for costs must be 1–${COSTS_LIMITS['1d'].max}`, {
        type: 'validation_error',
      });
    }
    return this._allPages<CostsResult>(ADMIN_ENDPOINTS.costs, {
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
  async assessImageCosts(
    range: { start_time: number; end_time: number },
    filters: AssessmentFilters = {}
  ): Promise<CostAssessment> {
    if (
      !Number.isInteger(range.start_time) ||
      !Number.isInteger(range.end_time) ||
      range.end_time <= range.start_time
    ) {
      throw new OpenAIImageAPIError(
        'range.start_time and range.end_time must be integer Unix seconds with end after start',
        { type: 'validation_error' }
      );
    }
    const scope = { project_ids: filters.project_ids, api_key_ids: filters.api_key_ids };
    const [completionPages, imagePages, costPages] = await Promise.all([
      this.listCompletionsUsage({
        ...range,
        bucket_width: '1d',
        group_by: ['project_id', 'api_key_id', 'model'],
        ...scope,
      }),
      this.listImagesUsage({
        ...range,
        bucket_width: '1d',
        group_by: ['project_id', 'api_key_id', 'user_id', 'model', 'size', 'source'],
        ...scope,
      }),
      this.listCosts({ ...range, group_by: ['project_id', 'api_key_id', 'line_item'], ...scope }),
    ]);
    this.logger.info(
      `Fetched ${completionPages.length} completions, ${imagePages.length} images and ${costPages.length} costs page(s)`
    );
    return assess(imagePages, completionPages, costPages, range);
  }
}
