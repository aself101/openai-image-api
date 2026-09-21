/**
 * `openai-img cost` — the cost-assessment subcommand.
 *
 * Kept apart from the generation CLI so the two option sets do not mix:
 * this one needs an admin key and a date range, nothing else in common.
 *
 * Range handling: both admin endpoints bucket by UTC day, so `--start` and
 * `--end` are snapped to UTC midnight (start down, end up) and the effective
 * range is printed. A request that would otherwise cover part of a day would
 * silently return the whole day's figures against a narrower-looking header.
 */
import { Command } from 'commander';
import path from 'path';
import { OpenAIAdminAPI } from './admin-api.js';
import { OpenAIImageAPIError } from './errors.js';
import { LOG_LEVELS, oneOf, optString, stringList } from './cli-options.js';
import { logger, setLogLevel, writeToFile, validateOutputPath, getErrorMessage } from './utils.js';
const DAY = 86_400;
/** Unix seconds of the UTC midnight at or before `unix` */
export const floorToUtcDay = (unix) => Math.floor(unix / DAY) * DAY;
/** Unix seconds of the UTC midnight at or after `unix` */
export const ceilToUtcDay = (unix) => Math.ceil(unix / DAY) * DAY;
/**
 * Accept a Unix-seconds integer, an ISO-8601 date/time, or `today` /
 * `yesterday` / `Nd` (N days ago, UTC midnight). Returns Unix seconds.
 */
export function parseTime(text, flag, now = new Date()) {
    const t = text.trim();
    const midnight = (d) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
    if (/^\d{9,11}$/.test(t))
        return Number(t);
    if (t === 'today')
        return midnight(now);
    if (t === 'yesterday')
        return midnight(now) - DAY;
    const rel = /^(\d+)d$/.exec(t);
    if (rel)
        return midnight(now) - Number(rel[1]) * DAY;
    const ms = Date.parse(t);
    if (Number.isNaN(ms)) {
        throw new Error(`${flag}: "${text}" is not Unix seconds, an ISO-8601 date, today, yesterday, or <N>d`);
    }
    return Math.floor(ms / 1000);
}
/**
 * Resolve `--start` / `--end` into the UTC-day-aligned range the endpoints
 * will answer for. `end` defaults to the end of the current UTC day.
 */
export function resolveRange(startText, endText, now = new Date()) {
    const start = parseTime(startText, '--start', now);
    const end = endText === 'now' ? Math.floor(now.getTime() / 1000) : parseTime(endText, '--end', now);
    if (end <= start)
        throw new Error('--end must be after --start');
    const start_time = floorToUtcDay(start);
    const end_time = ceilToUtcDay(end);
    return { start_time, end_time, snapped: start_time !== start || end_time !== end };
}
/** Build the subcommand's program */
export function buildCostProgram(version) {
    const collect = (value, previous) => [...previous, value];
    return new Command()
        .name('openai-img cost')
        .description('Reconcile organization image-model usage with organization costs, per UTC day, scope and model. Needs an ADMIN key (OPENAI_ADMIN_KEY).')
        .version(version)
        .requiredOption('--start <time>', 'Range start: Unix seconds, ISO-8601, today, yesterday, or <N>d (snapped down to UTC midnight)')
        .option('--end <time>', 'Range end, exclusive (snapped up to UTC midnight; default: end of the current UTC day)', 'now')
        .option('--project-id <id>', 'Restrict to a project (repeatable)', collect, [])
        .option('--api-key-id <id>', 'Restrict to an API key id (repeatable)', collect, [])
        .option('--json', 'Print the full assessment as JSON instead of a table')
        .option('--output <path>', 'Also write the JSON assessment to this file')
        .option('--admin-key <key>', 'Admin API key (overrides OPENAI_ADMIN_KEY). Visible in the process list on shared hosts')
        .option('--log-level <level>', LOG_LEVELS.join(', '), 'INFO');
}
/** Right-pad / left-pad helpers for the text table */
const pad = (s, n) => s.padEnd(n);
const rpad = (s, n) => s.padStart(n);
const money = (v, currency) => v === null ? '-' : `${v}${currency ? ` ${currency}` : ''}`;
const num = (v) => (v === null ? '-' : String(v));
/** Averages carry 12 decimals in the JSON; the table shows at most six */
const avg = (v) => (v === null ? '-' : v.replace(/^(-?\d+\.\d{2,6})\d*$/, '$1'));
const nonZero = (v) => v !== null && !/^-?0\.0+$/.test(v);
const scopeLabel = (r) => r.scope === 'organization'
    ? 'org'
    : [r.project_id && `proj=${r.project_id}`, r.api_key_id && `key=${r.api_key_id}`].filter(Boolean).join(' ');
/** One scope-level line */
function renderRow(r) {
    return [
        pad(r.period_start_iso.slice(0, 10) + (r.partial ? '*' : ' '), 11),
        pad(scopeLabel(r), 44),
        rpad(num(r.image_request_count), 8),
        rpad(num(r.output_image_tokens), 10),
        rpad(money(r.classified_image_cost, r.currency), 16),
        rpad(money(r.unclassified_cost, r.currency), 16),
        rpad(money(r.total_cost, r.currency), 14),
        rpad(avg(r.average_cost_per_request), 10),
        pad(r.attribution_level, 48),
    ].join('  ');
}
/** One model line beneath its scope row */
function renderModel(m) {
    const flags = [m.match !== 'exact' && m.match, m.tokens_reconcile === false && 'tokens≠'].filter(Boolean).join(',');
    return [
        pad('', 11),
        pad(`  ${m.model}${flags ? ` [${flags}]` : ''}`, 44),
        rpad(num(m.requests), 8),
        rpad(num(m.output_image_tokens), 10),
        rpad(money(m.cost.total, m.currency), 16),
        rpad('', 16),
        rpad('', 14),
        rpad(avg(m.average_cost_per_request), 10),
        pad([
            nonZero(m.cost.image_input) && `img-in ${m.cost.image_input}`,
            nonZero(m.cost.image_cached_input) && `img-cached ${m.cost.image_cached_input}`,
            nonZero(m.cost.image_output) && `img-out ${m.cost.image_output}`,
            nonZero(m.cost.text_input) && `txt-in ${m.cost.text_input}`,
            nonZero(m.cost.text_cached_input) && `txt-cached ${m.cost.text_cached_input}`,
            nonZero(m.cost.text_output) && `txt-out ${m.cost.text_output}`,
        ]
            .filter(Boolean)
            .join(' '), 48),
    ].join('  ');
}
/** Render the whole assessment as text */
export function renderAssessment(a, now = new Date()) {
    const lines = [];
    const from = new Date(a.range.start_time * 1000).toISOString().slice(0, 10);
    const to = new Date(a.range.end_time * 1000).toISOString().slice(0, 10);
    lines.push(`Image cost assessment  ${from} → ${to} (UTC days, end exclusive)  classifier ${a.classifier_version}`);
    lines.push('');
    lines.push([
        pad('day', 11),
        pad('scope / model', 44),
        rpad('requests', 8),
        rpad('out img tk', 10),
        rpad('image cost', 16),
        rpad('unclassified', 16),
        rpad('all-API', 14),
        rpad('avg/req', 10),
        pad('attribution / components', 48),
    ].join('  '));
    lines.push('-'.repeat(176));
    for (const r of a.rows) {
        lines.push(renderRow(r));
        for (const m of r.models)
            lines.push(renderModel(m));
    }
    if (a.rows.length === 0)
        lines.push('(no rows: no endpoint returned data for this range)');
    lines.push('');
    const images = a.totals.image_count === null ? '' : `, ${a.totals.image_count} image(s) from the images endpoint`;
    lines.push(`Totals: ${a.totals.image_request_count} image-model request(s), ${a.totals.output_image_tokens} output image tokens${images}`);
    for (const c of a.totals.by_currency) {
        lines.push(`  ${c.currency}: image-classified ${c.classified_image_cost}, unclassified ${c.unclassified_cost}, other ${c.other_known_cost}, all-API total ${c.total_cost}`);
    }
    if (a.totals.by_model.length) {
        lines.push('By model family:');
        for (const m of a.totals.by_model) {
            lines.push(`  ${pad(m.family, 28)} ${rpad(String(m.requests), 8)} req  ${rpad(String(m.output_image_tokens), 10)} out img tk  ${money(m.image_cost, m.currency)}`);
        }
    }
    if (a.observed_line_items.length)
        lines.push(`Line items seen: ${a.observed_line_items.map((s) => JSON.stringify(s)).join(', ')}`);
    const rowWarnings = new Map();
    // row warnings already carry each model's warnings, prefixed with the model id
    for (const r of a.rows)
        for (const w of r.warnings)
            rowWarnings.set(w, (rowWarnings.get(w) ?? 0) + 1);
    if (a.warnings.length || rowWarnings.size) {
        lines.push('');
        lines.push('Warnings:');
        for (const w of a.warnings)
            lines.push(`  - ${w}`);
        for (const [w, n] of rowWarnings)
            lines.push(`  - ${w}${n > 1 ? ` (${n} rows)` : ''}`);
    }
    lines.push('');
    const notes = [
        '"image cost" is spend whose Costs line item names an image model (e.g. "gpt-image-2.5-flare image, output"); ' +
            '"unclassified" is spend with no such signal. Model rows join usage to cost by model id within the same day and scope; [family] marks a join across a snapshot suffix, [cost_only] / [activity_only] a model seen on one side.',
    ];
    if (a.rows.some((r) => r.partial))
        notes.push('* marks a day that extends past the requested end — its figures cover the whole UTC day.');
    const lastBucket = a.rows.length ? Math.max(...a.rows.map((r) => r.period_end)) : 0;
    if (lastBucket > Math.floor(now.getTime() / 1000) - DAY) {
        notes.push('The Costs endpoint lags usage; the most recent day may show activity with little or no cost yet. Re-run tomorrow for a settled figure.');
    }
    lines.push(...notes);
    return lines.join('\n');
}
/**
 * Run `openai-img cost`. Returns the exit code.
 *
 * @param argv - Full argv (node, script, 'cost', ...flags)
 * @param version - Package version for --version
 */
export async function runCostCli(argv, version) {
    const program = buildCostProgram(version);
    // commander expects [node, script, ...args]; drop the 'cost' token
    program.parse([argv[0] ?? 'node', argv[1] ?? 'openai-img', ...argv.slice(3)]);
    const raw = program.opts();
    try {
        const levelText = optString(raw.logLevel, '--log-level')?.toUpperCase();
        const logLevel = oneOf(levelText, LOG_LEVELS, '--log-level') ?? 'INFO';
        setLogLevel(logLevel);
        const now = new Date();
        const range = resolveRange(optString(raw.start, '--start') ?? '', optString(raw.end, '--end') ?? 'now', now);
        if (range.snapped) {
            logger.info(`Range snapped to UTC days: ${new Date(range.start_time * 1000).toISOString()} → ${new Date(range.end_time * 1000).toISOString()}`);
        }
        const projectIds = stringList(raw.projectId, '--project-id');
        const apiKeyIds = stringList(raw.apiKeyId, '--api-key-id');
        const adminKey = optString(raw.adminKey, '--admin-key');
        if (adminKey)
            logger.warn('--admin-key is visible in the process list on shared hosts; prefer OPENAI_ADMIN_KEY');
        const admin = new OpenAIAdminAPI({ adminKey, logLevel });
        const assessment = await admin.assessImageCosts({ start_time: range.start_time, end_time: range.end_time }, { project_ids: projectIds.length ? projectIds : undefined, api_key_ids: apiKeyIds.length ? apiKeyIds : undefined });
        const output = optString(raw.output, '--output');
        if (output) {
            const target = validateOutputPath(output);
            await writeToFile(assessment, target, 'json');
            const rel = path.relative(process.cwd(), target);
            logger.info(`Wrote ${rel && !rel.startsWith('..') ? rel : target}`);
        }
        console.log(raw.json ? JSON.stringify(assessment, null, 2) : renderAssessment(assessment, now));
        return 0;
    }
    catch (error) {
        const detail = error instanceof OpenAIImageAPIError && error.apiMessage && !error.message.includes(error.apiMessage)
            ? ` (API: ${error.apiMessage}${error.code ? `; code: ${error.code}` : ''})`
            : '';
        logger.error(`\n✗ Error: ${getErrorMessage(error)}${detail}\n`);
        return 1;
    }
}
//# sourceMappingURL=cost-cli.js.map