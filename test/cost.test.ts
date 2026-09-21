/**
 * Cost assessment tests
 *
 * Fixture-driven tests of the pure reconciliation in src/cost.ts, plus the
 * admin client's pagination, retry and auth handling with axios mocked.
 *
 * Fixture values come from the live probe of 2026-09-21 (docs/openai-image-
 * cost-assessment-spec.md, revision 2026-09-21): on 2026-09-20 the completions
 * endpoint reported 5 requests / 2183 output image tokens for
 * gpt-image-2.5-flare, and the costs endpoint a line item
 * "gpt-image-2.5-flare image, output" with quantity 2183 and amount
 * 0.06549 — a to-the-token match.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import {
  assessImageCosts,
  classifyCostRow,
  parseLineItem,
  modelFamily,
  normalizeCosts,
  normalizeImages,
  normalizeCompletions,
  toScaled,
  formatAmount,
  AMOUNT_SCALE,
  UNKNOWN,
  type UsagePage,
  type ImagesUsageResult,
  type CompletionsUsageResult,
  type CostsResult,
} from '../src/cost.js';
import { OpenAIAdminAPI, USAGE_LIMITS, COSTS_LIMITS, preserveAmountText } from '../src/admin-api.js';
import { OpenAIImageAPIError } from '../src/errors.js';

vi.mock('axios');

// ---- fixture helpers -------------------------------------------------------

const DAY = 86400;
const T0 = Date.UTC(2026, 8, 20) / 1000; // 2026-09-20T00:00:00Z, the live probe's day
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
const SCOPE = { project_id: 'proj_RDRhp0UasXpMoGpzxIX3QfPT', api_key_id: 'key_5Zpk8F1o9ezQLxWx' };
const comp = (over: Partial<CompletionsUsageResult> = {}): CompletionsUsageResult => ({
  object: 'organization.usage.completions.result',
  model: 'gpt-image-2.5-flare',
  num_model_requests: 5,
  input_tokens: 40,
  output_tokens: 2183,
  input_text_tokens: 40,
  input_image_tokens: 0,
  input_cached_tokens: 0,
  output_text_tokens: 0,
  output_image_tokens: 2183,
  ...SCOPE,
  ...over,
});
const cost = (value: number | string, over: Partial<CostsResult> = {}): CostsResult => ({
  object: 'organization.costs.result',
  amount: { currency: 'usd', value },
  line_item: 'gpt-image-2.5-flare image, output',
  quantity: 2183,
  quantity_unit: 'tokens',
  ...SCOPE,
  ...over,
});
const range = { start_time: T0, end_time: T0 + DAY };
const none: UsagePage<never>[] = [];

describe('money', () => {
  it('parses decimal text exactly, including the wire forms the API emits', () => {
    expect(toScaled('0.0001050000000000000000000000000000000')).toBe(105_000_000n);
    expect(toScaled('0E-6176')).toBe(0n);
    expect(toScaled('0.06549')).toBe(65_490_000_000n);
    expect(toScaled('1e-3')).toBe(1_000_000_000n);
    expect(toScaled('-2.5')).toBe(-2_500_000_000_000n);
  });

  it('rounds the thirteenth decimal half-up, once', () => {
    expect(toScaled('0.0000000000005')).toBe(1n);
    expect(toScaled('0.0000000000004')).toBe(0n);
    expect(AMOUNT_SCALE).toBe(12);
  });

  it('accepts numbers through their shortest round-trip string and refuses junk', () => {
    expect(toScaled(0.06)).toBe(60_000_000_000n);
    expect(() => toScaled(NaN)).toThrow('not a finite number');
    expect(() => toScaled('1,00')).toThrow('not a decimal');
  });

  it('sums without float drift', () => {
    let total = 0n;
    for (let i = 0; i < 10; i++) total += toScaled('0.1');
    expect(formatAmount(total)).toBe('1.00');
  });

  it('formatAmount renders at least two decimals and trims trailing zeros beyond that', () => {
    expect(formatAmount(60_000_000_000n)).toBe('0.06');
    expect(formatAmount(10n ** 12n)).toBe('1.00');
    expect(formatAmount(65_490_000_000n)).toBe('0.06549');
    expect(formatAmount(-50_000_000_000n)).toBe('-0.05');
    expect(formatAmount(65_490_000_000n, 2)).toBe('0.06');
  });
});

describe('line items', () => {
  it('parses the <model> <modality>, <component> form and nothing else', () => {
    expect(parseLineItem('gpt-image-2.5-flare image, output')).toEqual({
      model: 'gpt-image-2.5-flare',
      modality: 'image',
      component: 'output',
    });
    expect(parseLineItem('gpt-image-1.5-2025-12-16 text, cached input')).toEqual({
      model: 'gpt-image-1.5-2025-12-16',
      modality: 'text',
      component: 'cached input',
    });
    expect(parseLineItem('gpt-image-2.5-flare, image output tokens')).toBeNull();
    expect(parseLineItem('Image models')).toBeNull();
    expect(parseLineItem(null)).toBeNull();
  });

  it('classifies image spend by parsed image model or unit, never by substring', () => {
    expect(classifyCostRow({ line_item: 'gpt-image-2.5-flare image, output', quantity_unit: 'tokens' })).toBe(
      'image_generation'
    );
    expect(classifyCostRow({ line_item: 'gpt-image-2.5-flare text, input', quantity_unit: 'tokens' })).toBe(
      'image_generation'
    );
    expect(classifyCostRow({ line_item: 'whatever', quantity_unit: 'images' })).toBe('image_generation');
    expect(classifyCostRow({ line_item: 'gpt-4.1 text, output', quantity_unit: 'tokens' })).toBe('unknown');
    expect(classifyCostRow({ line_item: 'gpt-image-2.5-flare, image output tokens', quantity_unit: 'tokens' })).toBe(
      'unknown'
    );
    expect(classifyCostRow({ line_item: null, quantity_unit: null })).toBe('unknown');
  });

  it('strips a trailing snapshot date to get the family', () => {
    expect(modelFamily('gpt-image-1-2025-04-23')).toBe('gpt-image-1');
    expect(modelFamily('gpt-image-2.5-flare')).toBe('gpt-image-2.5-flare');
  });
});

describe('normalization', () => {
  it('maps absent dimensions to the UNKNOWN sentinel, distinct from any id', () => {
    const { rows } = normalizeImages([page([bucket(T0, [img({ project_id: null, api_key_id: undefined })])])]);
    expect(rows[0]?.scope).toEqual({ project_id: UNKNOWN, api_key_id: UNKNOWN });
    expect(UNKNOWN).not.toBe('UNKNOWN');
    expect([...UNKNOWN].some((c) => c.charCodeAt(0) > 0x7f)).toBe(true); // non-ASCII: cannot collide with an id
  });

  it('skips results of other types and records them', () => {
    const { rows, skipped } = normalizeImages([
      page([bucket(T0, [img(), { object: 'organization.usage.completions.result' } as unknown as ImagesUsageResult])]),
    ]);
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([
      { endpoint: 'images', object: 'organization.usage.completions.result', provenance: ['images', 0, 0, 1] },
    ]);
  });

  it('keeps only image models from completions and counts the rest', () => {
    const { rows, nonImageModelRows } = normalizeCompletions([
      page([bucket(T0, [comp(), comp({ model: 'gpt-4.1' }), comp({ model: null })])]),
    ]);
    expect(rows.map((r) => r.model)).toEqual(['gpt-image-2.5-flare']);
    expect(rows[0]).toMatchObject({ source: 'completions', requests: 5, output_image_tokens: 2183, images: null });
    expect(nonImageModelRows).toBe(2);
  });

  it('refuses an incomplete page set and a gap in the sequence', () => {
    expect(() => normalizeCosts([page([bucket(T0, [cost(1)])], true, 'cursor')])).toThrow(
      'fetch every page before assessing'
    );
    expect(() => normalizeCosts([page([bucket(T0, [cost(1)])], false), page([bucket(T0 + DAY, [cost(1)])])])).toThrow(
      'the sequence has a gap'
    );
  });

  it('lowercases currency, parses exact text, and keeps a null amount as null', () => {
    const { rows } = normalizeCosts([
      page([
        bucket(T0, [
          cost('0.5', { amount: { currency: 'USD', value: '0.5000000000000000000000000000000000' } }),
          cost(0, { amount: null }),
        ]),
      ]),
    ]);
    expect(rows[0]?.amount).toEqual({ currency: 'usd', scaled: 500_000_000_000n });
    expect(rows[0]?.classification).toBe('image_generation');
    expect(rows[1]?.amount).toBeNull();
  });
});

describe('assessImageCosts', () => {
  it('joins usage to cost per model at an exact scope: the 2026-09-20 flare row', () => {
    const report = assessImageCosts(
      none,
      [page([bucket(T0, [comp()])])],
      [page([bucket(T0, [cost('0.06549')])])],
      range
    );

    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row).toMatchObject({
      scope: 'project_api_key',
      ...SCOPE,
      image_request_count: 5,
      image_count: null,
      output_image_tokens: 2183,
      classified_image_cost: '0.06549',
      unclassified_cost: null,
      total_cost: '0.06549',
      currency: 'usd',
      average_cost_per_request: '0.013098',
      average_cost_per_image: null,
      attribution_level: 'exact_scope_reconciliation',
      partial: false,
    });
    expect(row.models).toHaveLength(1);
    expect(row.models[0]).toMatchObject({
      model: 'gpt-image-2.5-flare',
      match: 'exact',
      requests: 5,
      output_image_tokens: 2183,
      cost: { image_output: '0.06549', total: '0.06549', text_input: null },
      cost_quantities: { image_output: 2183 },
      tokens_reconcile: true,
      average_cost_per_request: '0.013098',
    });
    expect(report.totals.by_model).toEqual([
      { family: 'gpt-image-2.5-flare', currency: 'usd', requests: 5, output_image_tokens: 2183, image_cost: '0.06549' },
    ]);
    expect(report.observed_models).toEqual(['gpt-image-2.5-flare']);
    expect(report.observed_line_items).toEqual(['gpt-image-2.5-flare image, output']);
    expect(report.warnings).toContain('images: no pages supplied');
  });

  it('flags a token mismatch between usage and cost quantity', () => {
    const report = assessImageCosts(
      none,
      [page([bucket(T0, [comp({ output_image_tokens: 2000 })])])],
      [page([bucket(T0, [cost('0.06549')])])],
      range
    );
    const m = report.rows[0].models[0];
    expect(m.tokens_reconcile).toBe(false);
    expect(m.warnings).toContain('image output tokens: usage reports 2000, cost quantity is 2183');
  });

  it('matches across a snapshot suffix by family and says so', () => {
    const report = assessImageCosts(
      none,
      [
        page([
          bucket(T0, [comp({ model: 'gpt-image-1-2025-04-23', num_model_requests: 2, output_image_tokens: 500 })]),
        ]),
      ],
      [page([bucket(T0, [cost('0.02', { line_item: 'gpt-image-1 image, output', quantity: 500 })])])],
      range
    );
    const m = report.rows[0].models[0];
    expect(m).toMatchObject({
      model: 'gpt-image-1',
      activity_model: 'gpt-image-1-2025-04-23',
      match: 'family',
      tokens_reconcile: true,
    });
    expect(m.warnings[0]).toMatch(/matched by model family/);
    expect(report.totals.by_model[0]).toMatchObject({ family: 'gpt-image-1', requests: 2, image_cost: '0.02' });
  });

  it('reports one-sided models as cost_only / activity_only', () => {
    const report = assessImageCosts(
      none,
      [page([bucket(T0, [comp({ model: 'gpt-image-2' })])])],
      [page([bucket(T0, [cost('0.01', { line_item: 'gpt-image-1-mini image, output' })])])],
      range
    );
    expect(report.rows[0].models.map((m) => [m.model, m.match])).toEqual([
      ['gpt-image-1-mini', 'cost_only'],
      ['gpt-image-2', 'activity_only'],
    ]);
    expect(report.rows[0].attribution_level).toBe('exact_scope_reconciliation');
  });

  it('sums the components of one model and keeps text spend on an image model as image spend', () => {
    const report = assessImageCosts(
      none,
      [page([bucket(T0, [comp({ input_text_tokens: 40 })])])],
      [
        page([
          bucket(T0, [
            cost('0.06549'),
            cost('0.0002', { line_item: 'gpt-image-2.5-flare text, input', quantity: 40 }),
            cost('0.0001', { line_item: 'gpt-image-2.5-flare image, input', quantity: 10 }),
          ]),
        ]),
      ],
      range
    );
    const m = report.rows[0].models[0];
    expect(m.cost).toEqual({
      image_input: '0.0001',
      image_cached_input: null,
      image_output: '0.06549',
      text_input: '0.0002',
      text_cached_input: null,
      text_output: null,
      total: '0.06579',
    });
    expect(m.tokens_reconcile).toBe(false); // image input: usage 0 vs quantity 10
    expect(report.rows[0].classified_image_cost).toBe('0.06579');
  });

  it('keeps non-image spend visible as unclassified and never attributes by co-occurrence', () => {
    const report = assessImageCosts(
      none,
      none,
      [page([bucket(T0, [cost('1.25', { line_item: 'gpt-4.1 text, output', quantity: 10000 })])])],
      range
    );
    expect(report.rows[0]).toMatchObject({
      classified_image_cost: null,
      unclassified_cost: '1.25',
      total_cost: '1.25',
      attribution_level: 'unattributed',
      models: [],
    });
    expect(report.rows[0].warnings.join('\n')).toMatch(/co-occurrence with activity is not attribution/);
    expect(report.totals.by_currency).toEqual([
      {
        currency: 'usd',
        classified_image_cost: '0.00',
        unclassified_cost: '1.25',
        other_known_cost: '0.00',
        total_cost: '1.25',
      },
    ]);
  });

  it('excludes foreign-currency rows from every total at the scope, atomically', () => {
    const report = assessImageCosts(
      none,
      [page([bucket(T0, [comp()])])],
      [page([bucket(T0, [cost('0.06549'), cost('0.03', { amount: { currency: 'eur', value: '0.03' } })])])],
      range
    );
    const row = report.rows[0];
    expect(row.currency).toBe('usd');
    expect(row.classified_image_cost).toBe('0.06549');
    expect(row.total_cost).toBe('0.06549');
    expect(row.excluded_foreign_currency).toEqual([
      { currency: 'eur', amount: '0.03', line_item: 'gpt-image-2.5-flare image, output' },
    ]);
    expect(row.models[0].cost.total).toBe('0.06549');
    expect(row.warnings[0]).toMatch(/1 cost row\(s\) in a currency other than usd/);
    expect(report.totals.by_currency.map((c) => c.currency)).toEqual(['eur', 'usd']);
  });

  it('never copies a broader-scope row onto a narrower scope', () => {
    const report = assessImageCosts(
      none,
      [page([bucket(T0, [comp()])])],
      [page([bucket(T0, [cost('0.06549', { api_key_id: null })])])],
      range
    );
    expect(report.rows.map((r) => [r.scope, r.attribution_level])).toEqual([
      ['project_api_key', 'unattributed'],
      ['project', 'shared_scope_estimate'],
    ]);
    const exact = report.rows[0];
    expect(exact.classified_image_cost).toBeNull();
    expect(exact.models[0]).toMatchObject({ match: 'activity_only', cost: { total: null } });
    expect(exact.warnings).toContain(
      'image activity with no cost rows at this scope and day (costs post after usage, or sit at a broader scope)'
    );
  });

  it('still reads the images endpoint for DALL-E-era activity and computes per-image averages', () => {
    const report = assessImageCosts(
      [
        page([
          bucket(T0, [
            img({
              images: 2,
              num_model_requests: 2,
              model: 'dall-e-3',
              size: '1024x1024',
              source: 'image.generation',
              ...SCOPE,
            }),
          ]),
        ]),
      ],
      none,
      [page([bucket(T0, [cost('0.08', { line_item: 'Image models', quantity: 2, quantity_unit: 'images' })])])],
      range
    );
    const row = report.rows[0];
    expect(row).toMatchObject({ image_count: 2, classified_image_cost: '0.08', average_cost_per_image: '0.04' });
    expect(row.image_breakdown).toEqual([
      { model: 'dall-e-3', size: '1024x1024', source: 'image.generation', user_id: null, images: 2, requests: 2 },
    ]);
    expect(row.models.map((m) => m.match)).toEqual(['activity_only']); // unit-classified spend has no model to join on
    expect(report.totals.image_count).toBe(2);
  });

  it('marks a bucket that runs past the requested end as partial', () => {
    const report = assessImageCosts(none, [page([bucket(T0, [comp()])])], none, {
      start_time: T0,
      end_time: T0 + 3600,
    });
    expect(report.rows[0].partial).toBe(true);
    expect(report.warnings).toContain('costs: no pages supplied; costs are absent, not zero');
  });

  it('orders rows by day, then most specific scope first', () => {
    const report = assessImageCosts(
      none,
      [
        page([
          bucket(T0, [
            comp(),
            comp({ api_key_id: null }),
            comp({ project_id: null }),
            comp({ project_id: null, api_key_id: null }),
          ]),
          bucket(T0 + DAY, [comp({ project_id: null, api_key_id: null })]),
        ]),
      ],
      none,
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

  it('records classifier version and per-row provenance', () => {
    const report = assessImageCosts(
      none,
      [page([bucket(T0, [comp()])])],
      [page([bucket(T0, [cost('0.06549')])])],
      range
    );
    expect(report.classifier_version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(report.rows[0].provenance).toEqual([
      ['completions', 0, 0, 0],
      ['costs', 0, 0, 0],
    ]);
  });
});

describe('preserveAmountText', () => {
  it('quotes amount values so JSON.parse cannot round them', () => {
    const raw =
      '{"amount":{"value":0.0001050000000000000000000000000000000,"currency":"usd"},"quantity":2183,"x":{"value": 0E-6176}}';
    const parsed = JSON.parse(preserveAmountText(raw)) as {
      amount: { value: string };
      quantity: number;
      x: { value: string };
    };
    expect(parsed.amount.value).toBe('0.0001050000000000000000000000000000000');
    expect(parsed.x.value).toBe('0E-6176');
    expect(parsed.quantity).toBe(2183);
  });
});

describe('OpenAIAdminAPI', () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENAI_ADMIN_KEY = 'sk-admin-test';
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('requires an admin key and names the credential kind', () => {
    delete process.env.OPENAI_ADMIN_KEY;
    expect(() => new OpenAIAdminAPI()).toThrow(/OPENAI_ADMIN_KEY not found.*admin key/);
  });

  it('refuses a non-HTTPS base URL as a configuration error', () => {
    const err = (() => {
      try {
        new OpenAIAdminAPI({ baseUrl: 'http://api.openai.com' });
      } catch (e) {
        return e as OpenAIImageAPIError;
      }
    })();
    expect(err?.type).toBe('configuration_error');
  });

  it('follows next_page until has_more is false and repeats array params', async () => {
    (axios.get as Mock)
      .mockResolvedValueOnce({ status: 200, data: page([bucket(T0, [comp()])], true, 'cur1') })
      .mockResolvedValueOnce({ status: 200, data: page([bucket(T0 + DAY, [comp()])], false, null) });

    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    const pages = await admin.listCompletionsUsage({
      start_time: T0,
      end_time: T0 + 2 * DAY,
      group_by: ['project_id', 'api_key_id', 'model'],
    });

    expect(pages).toHaveLength(2);
    const calls = (axios.get as Mock).mock.calls;
    expect(calls[0][0]).toBe('https://api.openai.com/v1/organization/usage/completions');
    expect(calls[0][1].params).toMatchObject({
      start_time: T0,
      bucket_width: '1d',
      limit: 31,
      group_by: ['project_id', 'api_key_id', 'model'],
    });
    expect(calls[0][1].params.page).toBeUndefined();
    expect(calls[1][1].params.page).toBe('cur1');
    expect(calls[0][1].headers.Authorization).toBe('Bearer sk-admin-test');
    expect(calls[0][1].paramsSerializer).toEqual({ indexes: null });
    // the response transformer preserves amount text
    const transform = calls[0][1].transformResponse[0] as (s: string) => unknown;
    expect(transform('{"a":{"value":0.10000000000000000000000000000000001}}')).toEqual({
      a: { value: '0.10000000000000000000000000000000001' },
    });
  });

  it('refuses has_more without a cursor and a body of the wrong shape', async () => {
    (axios.get as Mock).mockResolvedValueOnce({ status: 200, data: page([], true, null) });
    await expect(new OpenAIAdminAPI({ logLevel: 'ERROR' }).listCosts({ start_time: T0 })).rejects.toThrow(
      'no next_page cursor'
    );
    (axios.get as Mock).mockResolvedValueOnce({ status: 200, data: { data: 'nope' } });
    await expect(new OpenAIAdminAPI({ logLevel: 'ERROR' }).listCosts({ start_time: T0 })).rejects.toThrow(
      'Unexpected response shape'
    );
  });

  it('bounds limit per bucket width', async () => {
    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    await expect(admin.listImagesUsage({ start_time: T0, bucket_width: '1h', limit: 169 })).rejects.toThrow('1–168');
    await expect(admin.listCosts({ start_time: T0, limit: 181 })).rejects.toThrow('1–180');
    expect(USAGE_LIMITS['1m'].max).toBe(1440);
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

  it('retries 429 and 5xx with backoff, and not a 400', async () => {
    vi.useFakeTimers();
    (axios.get as Mock)
      .mockRejectedValueOnce({ response: { status: 429, data: {} } })
      .mockRejectedValueOnce({ response: { status: 503, data: {} } })
      .mockResolvedValueOnce({ status: 200, data: page([bucket(T0, [cost('1')])]) });
    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    const pending = admin.listCosts({ start_time: T0 });
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    const pages = await pending;
    expect(pages).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledTimes(3);

    (axios.get as Mock).mockClear();
    (axios.get as Mock).mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'bad range' } } } });
    await expect(admin.listCosts({ start_time: T0 })).rejects.toThrow('API error (400): bad range');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and reports the rate limit', async () => {
    vi.useFakeTimers();
    (axios.get as Mock).mockRejectedValue({ response: { status: 429, data: {} } });
    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR', maxAttempts: 2 });
    const pending = admin.listCosts({ start_time: T0 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = (await pending) as OpenAIImageAPIError;
    expect(err.message).toMatch(/Rate limit exceeded after retries/);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('assessImageCosts issues one query per endpoint with aligned bounds and no line-item filter', async () => {
    (axios.get as Mock).mockImplementation((url: string) =>
      Promise.resolve({
        status: 200,
        data: url.includes('/usage/completions')
          ? page([bucket(T0, [comp()])])
          : url.includes('/usage/images')
            ? page([])
            : page([bucket(T0, [cost('0.06549')])]),
      })
    );
    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    const report = await admin.assessImageCosts(range, { project_ids: ['proj_a'] });

    expect(report.rows[0].attribution_level).toBe('exact_scope_reconciliation');
    const calls = (axios.get as Mock).mock.calls as Array<[string, { params: Record<string, unknown> }]>;
    const byUrl = Object.fromEntries(calls.map(([url, cfg]) => [url.split('/v1/organization/')[1], cfg.params]));
    expect(byUrl['usage/completions']).toMatchObject({
      start_time: T0,
      end_time: T0 + DAY,
      bucket_width: '1d',
      group_by: ['project_id', 'api_key_id', 'model'],
      project_ids: ['proj_a'],
    });
    expect(byUrl['usage/images']).toMatchObject({
      group_by: ['project_id', 'api_key_id', 'user_id', 'model', 'size', 'source'],
      project_ids: ['proj_a'],
    });
    expect(byUrl['costs']).toMatchObject({
      start_time: T0,
      end_time: T0 + DAY,
      bucket_width: '1d',
      group_by: ['project_id', 'api_key_id', 'line_item'],
      project_ids: ['proj_a'],
    });
    expect(byUrl['costs']?.line_items).toBeUndefined();
  });

  it('rejects an inverted or non-integer range before any request', async () => {
    const admin = new OpenAIAdminAPI({ logLevel: 'ERROR' });
    await expect(admin.assessImageCosts({ start_time: T0, end_time: T0 })).rejects.toThrow('end after start');
    expect(axios.get).not.toHaveBeenCalled();
  });
});
