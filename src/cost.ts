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

// =============================================================================
// Wire types (from the Admin API reference, docs/costs.md)
// =============================================================================

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
export type CostQuantityUnit =
  | 'tokens'
  | '1000_tokens'
  | 'duration_seconds'
  | 'duration_minutes'
  | 'duration_hours'
  | 'gibibyte_hours'
  | 'images'
  | 'characters';

/** `organization.costs.result` */
export interface CostsResult {
  object: 'organization.costs.result';
  amount?: { currency?: string | null; value?: number | null } | null;
  api_key_id?: string | null;
  line_item?: string | null;
  project_id?: string | null;
  quantity?: number | null;
  /** One of CostQuantityUnit when documented; the schema allows other strings */
  quantity_unit?: string | null;
}

// =============================================================================
// Money: integer micro-units, per currency
// =============================================================================

/** Micro-units per whole currency unit (6 decimals) */
export const MICRO = 1_000_000n;

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
export function toMicro(value: number): bigint {
  if (!Number.isFinite(value)) throw new TypeError(`Cost amount is not a finite number: ${String(value)}`);
  return BigInt(Math.round(value * Number(MICRO)));
}

/** Render micro-units as a decimal string with `decimals` places (default 6, trailing zeros trimmed to at least 2) */
export function formatMicro(micro: bigint, decimals: number = 6): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / MICRO;
  let frac = (abs % MICRO).toString().padStart(6, '0').slice(0, decimals);
  frac = frac.replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/** An amount in one currency */
export interface Money {
  /** Lowercase ISO-4217 code */
  currency: string;
  /** Integer micro-units */
  micro: bigint;
}

/** Sum amounts of one currency; throws if currencies differ */
function addMoney(a: Money | null, b: Money): Money {
  if (a === null) return { currency: b.currency, micro: b.micro };
  if (a.currency !== b.currency) {
    throw new Error(`Refusing to add ${b.currency} to ${a.currency}: currencies are never mixed`);
  }
  return { currency: a.currency, micro: a.micro + b.micro };
}

// =============================================================================
// Classification
// =============================================================================

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
export const IMAGE_LINE_ITEMS: ReadonlySet<string> = new Set<string>([]);

/** Exact `line_item` strings known NOT to be image spend (for display) */
export const OTHER_KNOWN_LINE_ITEMS: ReadonlySet<string> = new Set<string>([]);

/** Bump whenever either list changes; recorded in every assessment */
export const LINE_ITEM_CLASSIFIER_VERSION = '2026-09-21.1';

/**
 * Classify one cost row. Conservative by construction: only documented or
 * exact-match signals produce `image_generation`; everything else is
 * `unknown` and stays visible as unclassified spend.
 */
export function classifyCostRow(row: Pick<CostsResult, 'line_item' | 'quantity_unit'>): LineItemClass {
  if (row.quantity_unit === 'images') return 'image_generation';
  const item = row.line_item ?? null;
  if (item !== null && IMAGE_LINE_ITEMS.has(item)) return 'image_generation';
  if (item !== null && OTHER_KNOWN_LINE_ITEMS.has(item)) return 'other_known';
  return 'unknown';
}

// =============================================================================
// Normalized rows
// =============================================================================

/**
 * Sentinel for an absent optional dimension. Contains a NUL byte, which no
 * project, key, user or model id can, so it is distinct from every real value
 * while still being a plain string (map keys, template literals).
 */
export const UNKNOWN = '\u0000UNKNOWN';
/** A dimension value: a real id, or UNKNOWN */
export type Dim = string;

const dim = (v: string | null | undefined): Dim => (v === null || v === undefined || v === '' ? UNKNOWN : v);

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

const bucketKey = (b: UsageBucket<unknown>): BucketKey => ({ start_time: b.start_time, end_time: b.end_time });

/** Normalize Images pages. Throws if a page is incomplete (has_more without a next page fetched). */
export function normalizeImages(pages: UsagePage<ImagesUsageResult | { object: string }>[]): {
  rows: ImageRow[];
  skipped: SkippedRow[];
} {
  assertComplete(pages, 'images');
  const rows: ImageRow[] = [];
  const skipped: SkippedRow[] = [];
  pages.forEach((page, p) =>
    page.data.forEach((bucket, b) =>
      bucket.results.forEach((r, i) => {
        if (r.object !== 'organization.usage.images.result') {
          skipped.push({ endpoint: 'images', object: r.object, provenance: [p, b, i] });
          return;
        }
        const row = r as ImagesUsageResult;
        rows.push({
          bucket: bucketKey(bucket),
          scope: { project_id: dim(row.project_id), api_key_id: dim(row.api_key_id) },
          user_id: dim(row.user_id),
          model: dim(row.model),
          size: dim(row.size),
          source: dim(row.source),
          images: row.images,
          requests: row.num_model_requests,
          provenance: [p, b, i],
        });
      })
    )
  );
  return { rows, skipped };
}

/** Normalize Costs pages. Amounts become micro-units; currency lowercased. */
export function normalizeCosts(pages: UsagePage<CostsResult | { object: string }>[]): {
  rows: CostRow[];
  skipped: SkippedRow[];
} {
  assertComplete(pages, 'costs');
  const rows: CostRow[] = [];
  const skipped: SkippedRow[] = [];
  pages.forEach((page, p) =>
    page.data.forEach((bucket, b) =>
      bucket.results.forEach((r, i) => {
        if (r.object !== 'organization.costs.result') {
          skipped.push({ endpoint: 'costs', object: r.object, provenance: [p, b, i] });
          return;
        }
        const row = r as CostsResult;
        const value = row.amount?.value;
        const amount: Money | null =
          value === null || value === undefined
            ? null
            : { currency: (row.amount?.currency ?? 'usd').toLowerCase(), micro: toMicro(value) };
        rows.push({
          bucket: bucketKey(bucket),
          scope: { project_id: dim(row.project_id), api_key_id: dim(row.api_key_id) },
          line_item: dim(row.line_item),
          classification: classifyCostRow(row),
          amount,
          quantity: row.quantity ?? null,
          quantity_unit: row.quantity_unit ?? null,
          provenance: [p, b, i],
        });
      })
    )
  );
  return { rows, skipped };
}

/**
 * A report built from a partial page set would silently under-report. The
 * fetcher must follow `next_page` until `has_more` is false; this is the check
 * that it did.
 */
function assertComplete(pages: UsagePage<unknown>[], endpoint: string): void {
  if (pages.length === 0) return;
  const last = pages[pages.length - 1];
  if (last && last.has_more) {
    throw new Error(
      `${endpoint}: the last page still has has_more=true (next_page=${String(last.next_page)}); fetch every page before assessing`
    );
  }
}

// =============================================================================
// Assessment
// =============================================================================

/** Which scope a row describes */
export type ScopeLevel = 'organization' | 'project' | 'api_key' | 'project_api_key';

/** How confidently image spend was tied to image activity at this scope */
export type AttributionLevel =
  'exact_scope_reconciliation' | 'image_line_item_reconciliation' | 'shared_scope_estimate' | 'unattributed';

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
  provenance: { images: Array<[number, number, number]>; costs: Array<[number, number, number]> };
}

/** The whole report */
export interface CostAssessment {
  /** Inclusive start / exclusive end the caller requested, Unix seconds */
  range: { start_time: number; end_time: number };
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

interface ScopeAgg {
  bucket: BucketKey;
  scope: ScopeKey;
  images: number;
  requests: number;
  imageRows: ImageRow[];
  costRows: CostRow[];
  byClass: Partial<Record<LineItemClass, Money | null>>;
  total: Money | null;
  currencyConflict: boolean;
}

const scopeId = (b: BucketKey, s: ScopeKey): string => `${b.start_time}|${b.end_time}|${s.project_id}|${s.api_key_id}`;

const iso = (unix: number): string => new Date(unix * 1000).toISOString();

const levelOf = (s: ScopeKey): ScopeLevel =>
  s.project_id !== UNKNOWN && s.api_key_id !== UNKNOWN
    ? 'project_api_key'
    : s.project_id !== UNKNOWN
      ? 'project'
      : s.api_key_id !== UNKNOWN
        ? 'api_key'
        : 'organization';

const SPECIFICITY: Record<ScopeLevel, number> = { project_api_key: 3, project: 2, api_key: 1, organization: 0 };

const shown = (d: Dim): string | null => (d === UNKNOWN ? null : d);

/**
 * Build the assessment from complete page sets.
 *
 * `imagePages` must come from ONE Images query grouped by `project_id` and
 * `api_key_id` (plus any of user/model/size/source for display); its rows are
 * summed to the shared scope exactly once. Never pass the union of two
 * differently-grouped Images queries — that double counts. `costPages` must
 * come from one Costs query grouped by `project_id`, `api_key_id`, `line_item`.
 */
export function assessImageCosts(
  imagePages: UsagePage<ImagesUsageResult | { object: string }>[],
  costPages: UsagePage<CostsResult | { object: string }>[],
  range: { start_time: number; end_time: number }
): CostAssessment {
  const images = normalizeImages(imagePages);
  const costs = normalizeCosts(costPages);
  const reportWarnings: string[] = [];

  for (const s of [...images.skipped, ...costs.skipped]) {
    reportWarnings.push(
      `${s.endpoint}: skipped a result of type ${s.object} at page ${s.provenance[0]}, bucket ${s.provenance[1]}, result ${s.provenance[2]}`
    );
  }
  if (imagePages.length === 0) reportWarnings.push('images: no pages supplied; image counts are absent, not zero');
  if (costPages.length === 0) reportWarnings.push('costs: no pages supplied; costs are absent, not zero');

  // --- aggregate to (bucket, scope) --------------------------------------
  const aggs = new Map<string, ScopeAgg>();
  const agg = (b: BucketKey, s: ScopeKey): ScopeAgg => {
    const id = scopeId(b, s);
    let a = aggs.get(id);
    if (!a) {
      a = {
        bucket: b,
        scope: s,
        images: 0,
        requests: 0,
        imageRows: [],
        costRows: [],
        byClass: {},
        total: null,
        currencyConflict: false,
      };
      aggs.set(id, a);
    }
    return a;
  };

  for (const r of images.rows) {
    const a = agg(r.bucket, r.scope);
    a.images += r.images;
    a.requests += r.requests;
    a.imageRows.push(r);
  }
  for (const r of costs.rows) {
    const a = agg(r.bucket, r.scope);
    a.costRows.push(r);
    if (r.amount) {
      try {
        a.byClass[r.classification] = addMoney(a.byClass[r.classification] ?? null, r.amount);
        a.total = addMoney(a.total, r.amount);
      } catch {
        a.currencyConflict = true;
      }
    }
  }

  // --- emit rows ------------------------------------------------------------
  const observed = new Set<string>();
  for (const r of costs.rows) if (r.line_item !== UNKNOWN) observed.add(r.line_item);

  const rows: AssessmentRow[] = [];
  for (const a of aggs.values()) {
    const level = levelOf(a.scope);
    const warnings: string[] = [];
    const hasImages = a.imageRows.length > 0;
    const hasCosts = a.costRows.length > 0;
    const imageCost = a.byClass.image_generation ?? null;
    const unknownCost = a.byClass.unknown ?? null;
    const otherCost = a.byClass.other_known ?? null;

    if (a.currencyConflict) {
      warnings.push(
        'cost rows at this scope carry more than one currency; per-class totals exclude the conflicting rows'
      );
    }
    if (hasImages && !hasCosts)
      warnings.push('image activity with no cost row at this scope (cost may sit at a broader scope)');
    if (hasCosts && !hasImages) warnings.push('cost with no image activity at this scope');
    if (level !== 'project_api_key') {
      warnings.push(
        `scope is ${level}: rows with an unknown project or API key are reported here, never copied onto narrower scopes`
      );
    }
    if (unknownCost && !imageCost) {
      warnings.push(
        'cost rows have no image-specific signal (line_item unknown, quantity_unit not images); co-occurrence with image activity is not attribution'
      );
    }
    for (const r of a.costRows) {
      if (r.amount === null) warnings.push(`a cost row (line_item ${shown(r.line_item) ?? 'null'}) has no amount`);
    }

    const exact = level === 'project_api_key';
    // Attribution follows image-CLASSIFIED cost only. Images sitting next to
    // unclassified spend in the same bucket and scope is co-occurrence, which
    // the spec rules out as evidence — that case is `unattributed`.
    let attribution: AttributionLevel;
    if (!imageCost) attribution = 'unattributed';
    else if (!hasImages) attribution = 'shared_scope_estimate';
    else attribution = exact ? 'exact_scope_reconciliation' : 'image_line_item_reconciliation';
    if (attribution === 'shared_scope_estimate') {
      warnings.push(
        'estimate: image-classified spend at a scope with no image activity rows; the activity may sit at a narrower or broader scope'
      );
    }
    if (attribution === 'image_line_item_reconciliation') {
      warnings.push(
        'image spend and activity share this scope but not an exact project + API key pair; the average is not computed'
      );
    }

    const canAverage = exact && imageCost !== null && a.images > 0;
    const average = canAverage ? formatMicro(imageCost.micro / BigInt(a.images)) : null;
    const coverage =
      imageCost && a.total && a.total.micro > 0n ? Number(imageCost.micro) / Number(a.total.micro) : null;
    const currency = a.total?.currency ?? imageCost?.currency ?? unknownCost?.currency ?? null;

    rows.push({
      period_start: a.bucket.start_time,
      period_end: a.bucket.end_time,
      period_start_iso: iso(a.bucket.start_time),
      period_end_iso: iso(a.bucket.end_time),
      scope: level,
      project_id: shown(a.scope.project_id),
      api_key_id: shown(a.scope.api_key_id),
      image_count: hasImages ? a.images : null,
      image_request_count: hasImages ? a.requests : null,
      classified_image_cost: imageCost ? formatMicro(imageCost.micro) : null,
      unclassified_cost: unknownCost ? formatMicro(unknownCost.micro) : null,
      other_known_cost: otherCost ? formatMicro(otherCost.micro) : null,
      total_cost: a.total ? formatMicro(a.total.micro) : null,
      currency,
      average_cost_per_image: average,
      image_cost_coverage: coverage,
      attribution_level: attribution,
      warnings,
      line_items: a.costRows.map((r) => ({
        line_item: shown(r.line_item),
        classification: r.classification,
        amount: r.amount ? formatMicro(r.amount.micro) : null,
        quantity: r.quantity,
        quantity_unit: r.quantity_unit,
      })),
      image_breakdown: a.imageRows.map((r) => ({
        model: shown(r.model),
        size: shown(r.size),
        source: shown(r.source),
        user_id: shown(r.user_id),
        images: r.images,
        requests: r.requests,
      })),
      provenance: { images: a.imageRows.map((r) => r.provenance), costs: a.costRows.map((r) => r.provenance) },
    });
  }

  rows.sort(
    (x, y) =>
      x.period_start - y.period_start ||
      SPECIFICITY[y.scope] - SPECIFICITY[x.scope] ||
      (x.project_id ?? '').localeCompare(y.project_id ?? '') ||
      (x.api_key_id ?? '').localeCompare(y.api_key_id ?? '')
  );

  // --- totals, per currency -------------------------------------------------
  const perCurrency = new Map<string, { image: bigint; unknown: bigint; other: bigint; total: bigint }>();
  for (const r of costs.rows) {
    if (!r.amount) continue;
    const t = perCurrency.get(r.amount.currency) ?? { image: 0n, unknown: 0n, other: 0n, total: 0n };
    if (r.classification === 'image_generation') t.image += r.amount.micro;
    else if (r.classification === 'other_known') t.other += r.amount.micro;
    else t.unknown += r.amount.micro;
    t.total += r.amount.micro;
    perCurrency.set(r.amount.currency, t);
  }

  return {
    range,
    classifier_version: LINE_ITEM_CLASSIFIER_VERSION,
    rows,
    warnings: reportWarnings,
    observed_line_items: [...observed].sort(),
    totals: {
      image_count: images.rows.reduce((n, r) => n + r.images, 0),
      image_request_count: images.rows.reduce((n, r) => n + r.requests, 0),
      by_currency: [...perCurrency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, t]) => ({
          currency,
          classified_image_cost: formatMicro(t.image),
          unclassified_cost: formatMicro(t.unknown),
          other_known_cost: formatMicro(t.other),
          total_cost: formatMicro(t.total),
        })),
    },
  };
}
