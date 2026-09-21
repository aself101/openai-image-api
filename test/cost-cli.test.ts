/**
 * Cost subcommand tests: time parsing, rendering, and the routed failure paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { parseTime, resolveRange, renderAssessment, runCostCli } from '../src/cost-cli.js';
import { runCli } from '../src/cli-core.js';
import { assessImageCosts, type UsagePage, type CompletionsUsageResult, type CostsResult } from '../src/cost.js';
import { logger, setLogLevel } from '../src/utils.js';
import winston from 'winston';
import { Writable } from 'stream';

/**
 * Capture what the logger's transports receive. Failure paths assert on these
 * bytes rather than on a spied `logger.error`: a spy is satisfied by a call the
 * transport never emits, which is how the muted WARNING level survived 3.0.0.
 */
function captureLog(): { written: string[]; release: () => void } {
  const written: string[] = [];
  const capture = new winston.transports.Stream({
    stream: new Writable({
      write(chunk, _enc, cb) {
        written.push(String(chunk));
        cb();
      },
    }),
  });
  logger.add(capture);
  return { written, release: () => logger.remove(capture) };
}

vi.mock('axios');

const argv = (...args: string[]) => ['node', 'openai-img', 'cost', ...args];
const NOW = new Date('2026-09-21T15:30:00Z');

describe('parseTime', () => {
  it('accepts Unix seconds, ISO dates, and relative day tokens (UTC midnight)', () => {
    expect(parseTime('1730419200', '--start', NOW)).toBe(1730419200);
    expect(parseTime('2024-11-01', '--start', NOW)).toBe(1730419200);
    expect(parseTime('2024-11-01T12:00:00Z', '--start', NOW)).toBe(1730419200 + 43200);
    expect(parseTime('today', '--start', NOW)).toBe(Date.UTC(2026, 8, 21) / 1000);
    expect(parseTime('yesterday', '--start', NOW)).toBe(Date.UTC(2026, 8, 20) / 1000);
    expect(parseTime('7d', '--start', NOW)).toBe(Date.UTC(2026, 8, 14) / 1000);
  });

  it('names the flag and the accepted forms on junk', () => {
    expect(() => parseTime('banana', '--end', NOW)).toThrow('--end: "banana" is not Unix seconds, an ISO-8601 date');
  });
});

describe('resolveRange', () => {
  it('snaps start down and end up to UTC midnight and reports it', () => {
    const r = resolveRange('2026-09-18T10:00:00Z', 'now', NOW);
    expect(r).toEqual({
      start_time: Date.UTC(2026, 8, 18) / 1000,
      end_time: Date.UTC(2026, 8, 22) / 1000,
      snapped: true,
    });
    expect(resolveRange('7d', 'today', NOW).snapped).toBe(false);
    expect(() => resolveRange('today', 'yesterday', NOW)).toThrow('--end must be after --start');
  });
});

describe('renderAssessment', () => {
  it('renders the live flare row with its model line, family totals and lag footer', () => {
    const T0 = Date.UTC(2026, 8, 20) / 1000;
    const completions: UsagePage<CompletionsUsageResult>[] = [
      {
        object: 'page',
        has_more: false,
        next_page: null,
        data: [
          {
            object: 'bucket',
            start_time: T0,
            end_time: T0 + 86400,
            results: [
              {
                object: 'organization.usage.completions.result',
                model: 'gpt-image-2.5-flare',
                num_model_requests: 5,
                input_tokens: 0,
                output_tokens: 2183,
                output_image_tokens: 2183,
                project_id: 'proj_a',
                api_key_id: 'key_a',
              },
            ],
          },
        ],
      },
    ];
    const costs: UsagePage<CostsResult>[] = [
      {
        object: 'page',
        has_more: false,
        next_page: null,
        data: [
          {
            object: 'bucket',
            start_time: T0,
            end_time: T0 + 86400,
            results: [
              {
                object: 'organization.costs.result',
                amount: { currency: 'usd', value: '0.06549' },
                line_item: 'gpt-image-2.5-flare image, output',
                quantity: 2183,
                quantity_unit: 'tokens',
                project_id: 'proj_a',
                api_key_id: 'key_a',
              },
            ],
          },
        ],
      },
    ];
    const text = renderAssessment(
      assessImageCosts([], completions, costs, { start_time: T0, end_time: T0 + 86400 }),
      new Date('2026-09-20T18:00:00Z')
    );
    expect(text).toContain('2026-09-20 → 2026-09-21 (UTC days');
    expect(text).toMatch(
      /2026-09-20\s+proj=proj_a key=key_a\s+5\s+2183\s+0\.06549 usd\s+-\s+0\.06549 usd\s+0\.013098\s+exact_scope_reconciliation/
    );
    expect(text).toMatch(/gpt-image-2\.5-flare\s+5\s+2183\s+0\.06549 usd\s+0\.013098\s+img-out 0\.06549/);
    expect(text).toContain('usd: image-classified 0.06549, unclassified 0.00, other 0.00, all-API total 0.06549');
    expect(text).toContain('By model family:');
    expect(text).toContain('The Costs endpoint lags usage');
    expect(text).not.toContain('* marks a day');
  });

  it('marks partial days and omits the lag footer for a settled range', () => {
    const T0 = 1730419200;
    const text = renderAssessment(
      assessImageCosts(
        [],
        [
          {
            object: 'page',
            has_more: false,
            next_page: null,
            data: [
              {
                object: 'bucket',
                start_time: T0,
                end_time: T0 + 86400,
                results: [
                  { object: 'organization.usage.completions.result', model: 'gpt-image-1', num_model_requests: 1 },
                ],
              },
            ],
          },
        ],
        [],
        { start_time: T0, end_time: T0 + 3600 }
      ),
      NOW
    );
    expect(text).toMatch(/2024-11-01\*\s+org/);
    expect(text).toContain('* marks a day');
    expect(text).not.toContain('lags usage');
  });
});

describe('runCostCli', () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENAI_ADMIN_KEY = 'sk-admin-test';
    setLogLevel('ERROR');
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('is reachable through the main runCli router', async () => {
    const log = captureLog();
    try {
      expect(await runCli(argv('--start', 'banana'), '3.1.0')).toBe(1);
    } finally {
      log.release();
    }
    expect(log.written.join('')).toContain('--start: "banana"');
  });

  it('fails clearly without an admin key', async () => {
    delete process.env.OPENAI_ADMIN_KEY;
    const log = captureLog();
    try {
      expect(await runCostCli(argv('--start', '7d'), '3.1.0')).toBe(1);
    } finally {
      log.release();
    }
    expect(log.written.join('')).toContain('OPENAI_ADMIN_KEY not found');
  });

  it('rejects an end before start', async () => {
    const log = captureLog();
    try {
      expect(await runCostCli(argv('--start', '2024-11-02', '--end', '2024-11-01'), '3.1.0')).toBe(1);
    } finally {
      log.release();
    }
    expect(log.written.join('')).toContain('--end must be after --start');
  });

  it('prints JSON with --json and writes --output', async () => {
    (axios.get as Mock).mockImplementation((url: string) =>
      Promise.resolve({
        status: 200,
        data: {
          object: 'page',
          has_more: false,
          next_page: null,
          data: [
            {
              object: 'bucket',
              start_time: 1730419200,
              end_time: 1730505600,
              results: url.includes('/usage/completions')
                ? [
                    {
                      object: 'organization.usage.completions.result',
                      model: 'gpt-image-2',
                      num_model_requests: 2,
                      input_tokens: 0,
                      output_tokens: 0,
                    },
                  ]
                : url.includes('/usage/images')
                  ? []
                  : [
                      {
                        object: 'organization.costs.result',
                        amount: { currency: 'usd', value: '0.06' },
                        line_item: 'gpt-image-2 image, output',
                      },
                    ],
            },
          ],
        },
      })
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const out = './test-cost-out/assessment.json';
    const code = await runCostCli(
      argv('--start', '2024-11-01', '--end', '2024-11-02', '--json', '--output', out),
      '3.1.0'
    );
    expect(code).toBe(0);
    const printed = JSON.parse(String(log.mock.calls[0]?.[0])) as { rows: Array<{ attribution_level: string }> };
    expect(printed.rows[0]?.attribution_level).toBe('image_line_item_reconciliation');
    const fs = await import('fs/promises');
    const written = JSON.parse(await fs.readFile(out, 'utf8')) as { classifier_version: string };
    expect(written.classifier_version).toMatch(/^\d{4}-/);
    await fs.rm('./test-cost-out', { recursive: true, force: true });
  });
});
