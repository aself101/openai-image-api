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

import axios, { type AxiosResponse } from 'axios';
import winston from 'winston';
import { BASE_URL } from './config.js';
import { OpenAIImageAPIError, apiErrorBody } from './errors.js';
import { getErrorMessage, toWinstonLevel } from './utils.js';
import {
  assessImageCosts as assess,
  type CostAssessment,
  type CostsResult,
  type ImagesUsageResult,
  type UsagePage,
} from './cost.js';
import type { LogLevel, Logger } from './types.js';

/** Admin API endpoint paths, relative to BASE_URL */
export const ADMIN_ENDPOINTS = {
  imagesUsage: '/v1/organization/usage/images',
  costs: '/v1/organization/costs',
} as const satisfies Record<string, string>;

/** Images-usage bucket widths and their limit bounds (docs/image-costs.md) */
export const IMAGES_USAGE_LIMITS = {
  '1d': { default: 7, max: 31 },
  '1h': { default: 24, max: 168 },
  '1m': { default: 60, max: 1440 },
} as const;

/** Costs supports daily buckets only; limit 1–180, default 7 (docs/costs.md) */
export const COSTS_LIMITS = { '1d': { default: 7, max: 180 } } as const;

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

/** Query-string shape axios will serialize; arrays repeat the key */
type Query = Record<string, string | number | string[] | undefined>;

/**
 * Client for the organization usage endpoints.
 */
export class OpenAIAdminAPI {
  private logger: Logger;
  private adminKey: string;
  private baseUrl: string;
  private requestTimeout: number;

  constructor({
    adminKey = null,
    baseUrl = BASE_URL,
    logLevel = 'WARNING',
    requestTimeout = 60_000,
  }: AdminAPIOptions = {}) {
    this.logger = winston.createLogger({
      level: toWinstonLevel(logLevel),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(
          ({ timestamp, level, message }) => `${String(timestamp)} - ${level.toUpperCase()} - ${String(message)}`
        )
      ),
      transports: [new winston.transports.Console()],
    });

    if (baseUrl && !baseUrl.startsWith('https://')) {
      throw new OpenAIImageAPIError('API base URL must use HTTPS protocol for security', {
        type: 'configuration_error',
      });
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
  }

  /** Redacted key for logs */
  private _redacted(): string {
    return this.adminKey.length < 8 ? '[REDACTED]' : `sk-...${this.adminKey.slice(-4)}`;
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
      if (response.status === 403) {
        throw new OpenAIImageAPIError(
          'Access forbidden: the admin key lacks permission for organization usage.',
          details
        );
      }
      if (response.status === 429)
        throw new OpenAIImageAPIError('Rate limit exceeded. Please try again later.', details);
      throw new OpenAIImageAPIError(
        `API error (${response.status}): ${body?.message ?? getErrorMessage(error)}`,
        details
      );
    }
    throw new OpenAIImageAPIError(`Request failed: ${getErrorMessage(error)}`, { cause: error });
  }

  /** One GET with the admin bearer; returns the parsed body after a shape check */
  private async _get<R>(endpoint: string, query: Query): Promise<UsagePage<R>> {
    const url = `${this.baseUrl}${endpoint}`;
    this.logger.debug(`Admin API request: GET ${endpoint} (${this._redacted()}) ${JSON.stringify(query)}`);
    try {
      const response: AxiosResponse<unknown> = await axios.get(url, {
        headers: { Authorization: `Bearer ${this.adminKey}` },
        params: query,
        // repeat array keys: group_by=project_id&group_by=api_key_id
        paramsSerializer: { indexes: null },
        timeout: this.requestTimeout,
        maxContentLength: 64 * 1024 * 1024,
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
      this._throw(error);
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
  async listImagesUsage(query: ImagesUsageQuery): Promise<UsagePage<ImagesUsageResult>[]> {
    const width = query.bucket_width ?? '1d';
    const bounds = IMAGES_USAGE_LIMITS[width];
    const limit = query.limit ?? bounds.max;
    if (limit < 1 || limit > bounds.max) {
      throw new OpenAIImageAPIError(`limit for bucket_width ${width} must be 1–${bounds.max}`, {
        type: 'validation_error',
      });
    }
    return this._allPages<ImagesUsageResult>(ADMIN_ENDPOINTS.imagesUsage, {
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
        {
          type: 'validation_error',
        }
      );
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
