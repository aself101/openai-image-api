/**
 * `openai-img cost` — the cost-assessment subcommand.
 *
 * Kept apart from the generation CLI so the two option sets do not mix:
 * this one needs an admin key and a date range, nothing else in common.
 */

import { Command } from 'commander';
import path from 'path';
import { OpenAIAdminAPI } from './admin-api.js';
import { OpenAIImageAPIError } from './errors.js';
import type { AssessmentRow, CostAssessment } from './cost.js';
import { logger, setLogLevel, writeToFile, validateOutputPath, getErrorMessage } from './utils.js';
import type { LogLevel } from './types.js';

/** Parsed `cost` options */
export interface CostCliOptions {
  start: number;
  end: number;
  projectIds: string[];
  apiKeyIds: string[];
  json: boolean;
  output?: string;
  adminKey?: string;
  logLevel: LogLevel;
}

/**
 * Accept a Unix-seconds integer, an ISO-8601 date/time, or `today` /
 * `yesterday` / `Nd` (N days ago, UTC midnight). Returns Unix seconds.
 */
export function parseTime(text: string, flag: string, now: Date = new Date()): number {
  const t = text.trim();
  const midnight = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  if (/^\d{9,11}$/.test(t)) return Number(t);
  if (t === 'today') return midnight(now);
  if (t === 'yesterday') return midnight(now) - 86400;
  const rel = /^(\d+)d$/.exec(t);
  if (rel) return midnight(now) - Number(rel[1]) * 86400;
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) {
    throw new Error(`${flag}: "${text}" is not Unix seconds, an ISO-8601 date, today, yesterday, or <N>d`);
  }
  return Math.floor(ms / 1000);
}

/** Build the subcommand's program */
export function buildCostProgram(version: string): Command {
  const collect = (value: string, previous: string[]) => [...previous, value];
  return new Command()
    .name('openai-img cost')
    .description(
      'Reconcile organization image usage with organization costs, per UTC day and scope. Needs an ADMIN key (OPENAI_ADMIN_KEY).'
    )
    .version(version)
    .requiredOption('--start <time>', 'Range start, inclusive: Unix seconds, ISO-8601, today, yesterday, or <N>d')
    .option('--end <time>', 'Range end, exclusive (default: now)', 'now')
    .option('--project-id <id>', 'Restrict to a project (repeatable)', collect, [] as string[])
    .option('--api-key-id <id>', 'Restrict to an API key id (repeatable)', collect, [] as string[])
    .option('--json', 'Print the full assessment as JSON instead of a table')
    .option('--output <path>', 'Also write the JSON assessment to this file')
    .option(
      '--admin-key <key>',
      'Admin API key (overrides OPENAI_ADMIN_KEY). Visible in the process list on shared hosts'
    )
    .option('--log-level <level>', 'DEBUG, INFO, WARNING, ERROR', 'WARNING');
}

/** Right-pad / left-pad helpers for the text table */
const pad = (s: string, n: number) => s.padEnd(n);
const rpad = (s: string, n: number) => s.padStart(n);

/** Render one assessment row for the terminal */
function renderRow(r: AssessmentRow): string {
  const day = r.period_start_iso.slice(0, 10);
  const scope =
    r.scope === 'organization'
      ? 'org'
      : [r.project_id && `proj=${r.project_id}`, r.api_key_id && `key=${r.api_key_id}`].filter(Boolean).join(' ');
  const cur = r.currency ? ` ${r.currency}` : '';
  return [
    pad(day, 10),
    pad(scope, 44),
    rpad(r.image_count === null ? '-' : String(r.image_count), 7),
    rpad(r.classified_image_cost === null ? '-' : r.classified_image_cost + cur, 14),
    rpad(r.unclassified_cost === null ? '-' : r.unclassified_cost + cur, 14),
    rpad(r.total_cost === null ? '-' : r.total_cost + cur, 12),
    rpad(r.average_cost_per_image === null ? '-' : r.average_cost_per_image, 9),
    pad(r.attribution_level, 32),
  ].join('  ');
}

/** Render the whole assessment as text */
export function renderAssessment(a: CostAssessment): string {
  const lines: string[] = [];
  const from = new Date(a.range.start_time * 1000).toISOString();
  const to = new Date(a.range.end_time * 1000).toISOString();
  lines.push(`Image cost assessment  ${from} → ${to} (UTC, end exclusive)  classifier ${a.classifier_version}`);
  lines.push('');
  lines.push(
    [
      pad('day', 10),
      pad('scope', 44),
      rpad('images', 7),
      rpad('image cost', 14),
      rpad('unclassified', 14),
      rpad('total', 12),
      rpad('avg/img', 9),
      pad('attribution', 32),
    ].join('  ')
  );
  lines.push('-'.repeat(150));
  for (const r of a.rows) lines.push(renderRow(r));
  if (a.rows.length === 0) lines.push('(no rows: neither endpoint returned data for this range)');
  lines.push('');
  lines.push(`Totals: ${a.totals.image_count} image(s) over ${a.totals.image_request_count} request(s)`);
  for (const c of a.totals.by_currency) {
    lines.push(
      `  ${c.currency}: image-classified ${c.classified_image_cost}, unclassified ${c.unclassified_cost}, other ${c.other_known_cost}, all-API total ${c.total_cost}`
    );
  }
  if (a.observed_line_items.length)
    lines.push(`Line items seen: ${a.observed_line_items.map((s) => JSON.stringify(s)).join(', ')}`);
  const rowWarnings = new Map<string, number>();
  for (const r of a.rows) for (const w of r.warnings) rowWarnings.set(w, (rowWarnings.get(w) ?? 0) + 1);
  if (a.warnings.length || rowWarnings.size) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of a.warnings) lines.push(`  - ${w}`);
    for (const [w, n] of rowWarnings) lines.push(`  - ${w}${n > 1 ? ` (${n} rows)` : ''}`);
  }
  lines.push('');
  lines.push(
    'Reading this: "image cost" is only spend the Costs endpoint marks as images (quantity_unit=images or a known line item). ' +
      '"unclassified" is spend with no such signal — it may or may not be images; the two endpoints share no request id, ' +
      'so co-occurrence is not attribution. Model-level cost is not available from these endpoints.'
  );
  return lines.join('\n');
}

/**
 * Run `openai-img cost`. Returns the exit code.
 *
 * @param argv - Full argv (node, script, 'cost', ...flags)
 * @param version - Package version for --version
 */
export async function runCostCli(argv: string[], version: string): Promise<number> {
  const program = buildCostProgram(version);
  // commander expects [node, script, ...args]; drop the 'cost' token
  program.parse([argv[0] ?? 'node', argv[1] ?? 'openai-img', ...argv.slice(3)]);
  const raw = program.opts<Record<string, unknown>>();
  const text = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

  try {
    const logLevel = text(raw.logLevel, 'WARNING').toUpperCase();
    if (!['DEBUG', 'INFO', 'WARNING', 'ERROR'].includes(logLevel)) {
      throw new Error(
        `Invalid value "${String(raw.logLevel)}" for --log-level. Valid options: DEBUG, INFO, WARNING, ERROR`
      );
    }
    setLogLevel(logLevel);

    const now = new Date();
    const start = parseTime(text(raw.start, ''), '--start', now);
    const endText = text(raw.end, 'now');
    const end = endText === 'now' ? Math.floor(now.getTime() / 1000) : parseTime(endText, '--end', now);
    if (end <= start) throw new Error('--end must be after --start');

    const projectIds = Array.isArray(raw.projectId) ? (raw.projectId as string[]) : [];
    const apiKeyIds = Array.isArray(raw.apiKeyId) ? (raw.apiKeyId as string[]) : [];
    const adminKey = typeof raw.adminKey === 'string' ? raw.adminKey : undefined;
    if (adminKey) logger.warn('--admin-key is visible in the process list on shared hosts; prefer OPENAI_ADMIN_KEY');

    const admin = new OpenAIAdminAPI({ adminKey, logLevel: logLevel as LogLevel });
    const assessment = await admin.assessImageCosts(
      { start_time: start, end_time: end },
      { project_ids: projectIds.length ? projectIds : undefined, api_key_ids: apiKeyIds.length ? apiKeyIds : undefined }
    );

    if (typeof raw.output === 'string' && raw.output) {
      const target = validateOutputPath(raw.output);
      await writeToFile(assessment, target, 'json');
      logger.info(`Wrote ${path.relative(process.cwd(), target) || target}`);
    }

    console.log(raw.json ? JSON.stringify(assessment, null, 2) : renderAssessment(assessment));
    return 0;
  } catch (error) {
    const detail =
      error instanceof OpenAIImageAPIError && error.apiMessage && !error.message.includes(error.apiMessage)
        ? ` (API: ${error.apiMessage}${error.code ? `; code: ${error.code}` : ''})`
        : '';
    logger.error(`\n✗ Error: ${getErrorMessage(error)}${detail}\n`);
    return 1;
  }
}
