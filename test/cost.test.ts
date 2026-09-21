/**
 * Cost assessment tests
 *
 * Fixture-driven tests of the pure reconciliation in src/cost.ts, plus the
 * admin client's pagination and auth handling with axios mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import {
  assessImageCosts,
  classifyCostRow,
  normalizeCosts,
  normalizeImages,
  toMicro,
  formatMicro,
  UNKNOWN,
  type UsagePage,
  type ImagesUsageResult,
  type CostsResult,
} from '../src/cost.js';
import { OpenAIAdminAPI, IMAGES_USAGE_LIMITS, COSTS_LIMITS } from '../src/admin-api.js';
import { OpenAIImageAPIError } from '../src/errors.js';

vi.mock('axios');

// ---- fixture helpers -------------------------------------------------------

const DAY = 86400;
const T0 = 1730419200; // 2024-11-01T00:00:00Z, the spec's worked example
const bucket = <R>(start: number, results: R[]) => ({
  object: 'bucket' as const,
  start_time: start,
  end_time: start + DAY,
  results,
});
const page = <R>(
  data: ReturnType<typeof bucket<R>>[],
  has_more = false,
  next_page: string | null = null
): UsagePage<R> => ({
  object: 'page',
  data,
  has_more,
  next_page,
});
const img = (over: Partial<ImagesUsageResult> = {}): ImagesUsageResult => ({
  object: 'organization.usage.images.result',
  images: 1,
  num_model_requests: 1,
  ...over,
});
const cost = (value: number, over: Partial<CostsResult> = {}): CostsResult => ({
  object: 'organization.costs.result',
  amount: { currency: 'usd', value },
  ...over,
});
const range = { start_time: T0, end_time: T0 + DAY };

describe('money', () => {
  it('toMicro recovers the decimal the API meant', () => {
    expect(toMicro(0.06)).toBe(60000n);
    expect(toMicro(0.1)).toBe(100000n);
    expect(toMicro(1234.567891)).toBe(1234567891n);
    expect(() => toMicro(NaN)).toThrow('not a finite number');
  });

  it('sums without float drift', () => {
    // 0.1 + 0.2 + … ten times is 1.0000000000000002 in doubles
    let total = 0n;
    for (let i = 0; i < 10; i++) total += toMicro(0.1);
    expect(formatMicro(total)).toBe('1.00');
  });

  it('formatMicro renders at least two decimals and trims trailing zeros beyond that', () => {
    expect(formatMicro(60000n)).toBe('0.06');
    expect(formatMicro(1_000_000n)).toBe('1.00');
    expect(formatMicro(1_234_567n)).toBe('1.234567');
    expect(formatMicro(-50_000n)).toBe('-0.05');
    expect(formatMicro(1_234_567n, 2)).toBe('1.23');
  });
});

describe('classifyCostRow', () => {
  it('treats quantity_unit images as the documented image-spend signal', () => {
    expect(classifyCostRow({ line_item: 'whatever', quantity_unit: 'images' })).toBe('image_generation');
  });

  it('never classifies on a substring', () => {
    expect(classifyCostRow({ line_item: 'gpt-image-2.5-flare, image output tokens', quantity_unit: 'tokens' })).toBe(
      'unknown'
    );
    expect(classifyCostRow({ line_item: null, quantity_unit: null })).toBe('unknown');
  });
});

describe('normalization', () => {
  it('maps absent dimensions to the UNKNOWN sentinel, distinct from any id', () => {
    const { rows } = normalizeImages([page([bucket(T0, [img({ project_id: null, api_key_id: undefined })])])]);
    expect(rows[0].scope).toEqual({ project_id: UNKNOWN, api_key_id: UNKNOWN });
    expect(UNKNOWN).not.toBe('UNKNOWN');
    expect(UNKNOWN).toContain('\u0000');
  });

  it('skips results of other types and records them', () => {
    const { rows, skipped } = normalizeImages([
      page([bucket(T0, [img(), { object: 'organization.usage.completions.result' } as unknown as ImagesUsageResult])]),
    ]);
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([
      { endpoint: 'images', object: 'organization.usage.completions.result', provenance: [0, 0, 1] },
    ]);
  });

  it('refuses an incomplete page set', () => {
    expect(() => normalizeCosts([page([bucket(T0, [cost(1)])], true, 'cursor')])).toThrow(
      'fetch every page before assessing'
    );
  });

  it('lowercases currency and keeps a null amount as null', () => {
    const { rows } = normalizeCosts([
      page([bucket(T0, [cost(0.5, { amount: { currency: 'USD', value: 0.5 } }), cost(0, { amount: null })])]),
    ]);
    expect(rows[0].amount).toEqual({ currency: 'usd', micro: 500000n });
    expect(rows[1].amount).toBeNull();
  });
});

describe('assessImageCosts', () => {
  it("reproduces the spec's worked example: 2 images, $0.06, all dimensions null → unattributed", () => {
    const report = assessImageCosts(
      [page([bucket(T0, [img({ images: 2, num_model_requests: 2 })])])],
      [page([bucket(T0, [cost(0.06)])])],
      range
    );

    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row).toMatchObject({
      period_start: T0,
      period_start_iso: '2024-11-01T00:00:00.000Z',
      period_end_iso: '2024-11-02T00:00:00.000Z',
      scope: 'organization',
      project_id: null,
      api_key_id: null,
      image_count: 2,
      image_request_count: 2,
      classified_image_cost: null,
      unclassified_cost: '0.06',
      total_cost: '0.06',
      currency: 'usd',
      average_cost_per_image: null,
      attribution_level: 'unattributed',
    });
    expect(row.warnings.join(' ')).toMatch(/no image-specific signal/);
    expect(report.totals).toEqual({
      image_count: 2,
      image_request_count: 2,
      by_currency: [
        {
          currency: 'usd',
          classified_image_cost: '0.00',
          unclassified_cost: '0.06',
          other_known_cost: '0.00',
          total_cost: '0.06',
        },
      ],
    });
  });

  it('reconciles exactly when project + API key match and the cost row is image-classified', () => {
    const scope = { project_id: 'proj_a', api_key_id: 'key_1' };
    const report = assessImageCosts(
      [page([bucket(T0, [img({ ...scope, images: 4, model: 'gpt-image-2.5-flare', source: 'image.generation' })])])],
      [page([bucket(T0, [cost(0.4, { ...scope, line_item: 'image tokens', quantity: 4, quantity_unit: 'images' })])])],
      range
    );
    const row = report.rows[0];
    expect(row.scope).toBe('project_api_key');
    expect(row.attribution_level).toBe('exact_scope_reconciliation');
    expect(row.classified_image_cost).toBe('0.40');
    expect(row.average_cost_per_image).toBe('0.10');
    expect(row.image_cost_coverage).toBe(1);
    expect(row.image_breakdown[0]).toMatchObject({
      model: 'gpt-image-2.5-flare',
      source: 'image.generation',
      images: 4,
    });
    expect(row.line_items[0]).toMatchObject({
      line_item: 'image tokens',
      classification: 'image_generation',
      quantity_unit: 'images',
    });
  });

  it('never joins a known id to an unknown one', () => {
    const report = assessImageCosts(
      [page([bucket(T0, [img({ project_id: 'proj_a', api_key_id: 'key_1', images: 3 })])])],
      [page([bucket(T0, [cost(0.3, { project_id: 'proj_a', api_key_id: null, quantity_unit: 'images' })])])],
      range
    );
    // two rows: the exact scope with images only, and the project scope with cost only
    expect(report.rows.map((r) => [r.scope, r.image_count, r.classified_image_cost])).toEqual([
      ['project_api_key', 3, null],
      ['project', null, '0.30'],
    ]);
    expect(report.rows[0].warnings.join(' ')).toMatch(/no cost row at this scope/);
    expect(report.rows[1].average_cost_per_image).toBeNull();
    expect(report.rows[1].attribution_level).toBe('shared_scope_estimate');
  });

  it('keeps cost-only and image-only buckets visible', () => {
    const report = assessImageCosts(
      [page([bucket(T0, [img({ images: 5 })])])],
      [page([bucket(T0 + DAY, [cost(1.25)])])],
      { start_time: T0, end_time: T0 + 2 * DAY }
    );
    expect(report.rows.map((r) => [r.period_start, r.image_count, r.total_cost])).toEqual([
      [T0, 5, null],
      [T0 + DAY, null, '1.25'],
    ]);
  });

  it('sums each scope once across model/size/source breakdown rows', () => {
    const scope = { project_id: 'p', api_key_id: 'k' };
    const report = assessImageCosts(
      [
        page([
          bucket(T0, [
            img({ ...scope, images: 2, model: 'gpt-image-2', size: '1024x1024', source: 'image.generation' }),
            img({ ...scope, images: 3, model: 'gpt-image-2.5-flare', size: '1536x1024', source: 'image.edit' }),
          ]),
        ]),
      ],
      [],
      range
    );
    expect(report.rows[0].image_count).toBe(5);
    expect(report.rows[0].image_breakdown).toHaveLength(2);
    expect(report.warnings.join(' ')).toMatch(/costs: no pages supplied/);
  });

  it('separates image, unknown and other-known spend and computes coverage', () => {
    const scope = { project_id: 'p', api_key_id: 'k' };
    const report = assessImageCosts(
      [page([bucket(T0, [img({ ...scope, images: 10 })])])],
      [
        page([
          bucket(T0, [
            cost(1.0, { ...scope, line_item: 'img', quantity_unit: 'images' }),
            cost(3.0, { ...scope, line_item: 'gpt-6-astra, input_tokens', quantity_unit: 'tokens' }),
          ]),
        ]),
      ],
      range
    );
    const row = report.rows[0];
    expect(row.classified_image_cost).toBe('1.00');
    expect(row.unclassified_cost).toBe('3.00');
    expect(row.total_cost).toBe('4.00');
    expect(row.image_cost_coverage).toBeCloseTo(0.25);
    expect(row.average_cost_per_image).toBe('0.10');
    expect(report.observed_line_items).toEqual(['gpt-6-astra, input_tokens', 'img']);
  });

  it('never mixes currencies', () => {
    const report = assessImageCosts(
      [],
      [
        page([
          bucket(T0, [
            cost(1, { amount: { currency: 'usd', value: 1 } }),
            cost(1, { amount: { currency: 'eur', value: 1 } }),
          ]),
        ]),
      ],
      range
    );
    expect(report.rows[0].warnings.join(' ')).toMatch(/more than one currency/);
    expect(report.totals.by_currency.map((c) => c.currency)).toEqual(['eur', 'usd']);
  });

  it('orders rows by bucket then scope specificity', () => {
    const report = assessImageCosts(
      [
        page([
          bucket(T0 + DAY, [img({ images: 1 })]),
          bucket(T0, [
            img({ project_id: 'p', api_key_id: 'k' }),
            img({ project_id: 'p' }),
            img({ api_key_id: 'k' }),
            img(),
          ]),
        ]),
      ],
      [],
      { start_time: T0, end_time: T0 + 2 * DAY }
    );
    expect(report.rows.map((r) => `${r.period_start === T0 ? 'd0' : 'd1'}:${r.scope}`)).toEqual([
      'd0:project_api_key',
      'd0:project',
      'd0:api_key',
      'd0:organization',
      'd1:organization',
    ]);
  });

  it('records classifier version and provenance', () => {
    const report = assessImageCosts([page([bucket(T0, [img()])])], [page([bucket(T0, [cost(0.5)])])], range);
    expect(report.classifier_version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(report.rows[0].provenance).toEqual({ images: [[0, 0, 0]], costs: [[0, 0, 0]] });
  });
});

describe('OpenAIAdminAPI', () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENAI_ADMIN_KEY = 'sk-admin-test';
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('requires an admin key and names the credential kind', () => {
    delete process.env.OPENAI_ADMIN_KEY;
    expect(() => new OpenAIAdminAPI()).toThrow(/OPENAI_ADMIN_KEY not found.*admin key/);
  });

  it('follows next_page until has_more is false and repeats array params', async () => {
    (axios.get as Mock)
      .mockResolvedValueOnce({ status: 200, data: page([bucket(T0, [img()])], true, 'cur1') })
      .mockResolvedValueOnce({ status: 200, data: page([bucket(T0 + DAY, [img()])], false, null) });

    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    const pages = await admin.listImagesUsage({
      start_time: T0,
      end_time: T0 + 2 * DAY,
      group_by: ['project_id', 'api_key_id'],
    });

    expect(pages).toHaveLength(2);
    const calls = (axios.get as Mock).mock.calls;
    expect(calls[0][0]).toBe('https://api.openai.com/v1/organization/usage/images');
    expect(calls[0][1].params).toMatchObject({
      start_time: T0,
      bucket_width: '1d',
      limit: 31,
      group_by: ['project_id', 'api_key_id'],
    });
    expect(calls[0][1].params.page).toBeUndefined();
    expect(calls[1][1].params.page).toBe('cur1');
    expect(calls[0][1].headers.Authorization).toBe('Bearer sk-admin-test');
    expect(calls[0][1].paramsSerializer).toEqual({ indexes: null });
  });

  it('refuses has_more without a cursor', async () => {
    (axios.get as Mock).mockResolvedValueOnce({ status: 200, data: page([], true, null) });
    await expect(new OpenAIAdminAPI({ logLevel: 'ERROR' }).listCosts({ start_time: T0 })).rejects.toThrow(
      'no next_page cursor'
    );
  });

  it('bounds limit per bucket width', async () => {
    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    await expect(admin.listImagesUsage({ start_time: T0, bucket_width: '1h', limit: 169 })).rejects.toThrow('1–168');
    await expect(admin.listCosts({ start_time: T0, limit: 181 })).rejects.toThrow('1–180');
    expect(IMAGES_USAGE_LIMITS['1m'].max).toBe(1440);
    expect(COSTS_LIMITS['1d'].default).toBe(7);
  });

  it('explains a 401 as a wrong-kind-of-key problem', async () => {
    (axios.get as Mock).mockRejectedValueOnce({
      response: { status: 401, data: { error: { message: 'bad', code: 'invalid_api_key' } } },
    });
    const err = (await new OpenAIAdminAPI({ logLevel: 'ERROR' })
      .listCosts({ start_time: T0 })
      .catch((e: unknown) => e)) as OpenAIImageAPIError;
    expect(err).toBeInstanceOf(OpenAIImageAPIError);
    expect(err.message).toMatch(/ADMIN key/);
    expect(err.code).toBe('invalid_api_key');
  });

  it('assessImageCosts issues one images query and one costs query with aligned bounds', async () => {
    (axios.get as Mock).mockImplementation((url: string) =>
      Promise.resolve({
        status: 200,
        data: url.includes('/usage/images')
          ? page([bucket(T0, [img({ images: 2 })])])
          : page([bucket(T0, [cost(0.06)])]),
      })
    );
    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    const report = await admin.assessImageCosts(range, { project_ids: ['proj_a'] });

    expect(report.rows[0].attribution_level).toBe('unattributed');
    const [imagesCall, costsCall] = (axios.get as Mock).mock.calls;
    expect(imagesCall[1].params).toMatchObject({
      start_time: T0,
      end_time: T0 + DAY,
      bucket_width: '1d',
      group_by: ['project_id', 'api_key_id', 'user_id', 'model', 'size', 'source'],
      project_ids: ['proj_a'],
    });
    expect(costsCall[1].params).toMatchObject({
      start_time: T0,
      end_time: T0 + DAY,
      bucket_width: '1d',
      group_by: ['project_id', 'api_key_id', 'line_item'],
      project_ids: ['proj_a'],
    });
    expect(costsCall[1].params.line_items).toBeUndefined();
  });

  it('rejects an inverted or non-integer range before any request', async () => {
    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    await expect(admin.assessImageCosts({ start_time: T0, end_time: T0 })).rejects.toThrow('end after start');
    expect(axios.get).not.toHaveBeenCalled();
  });
});
