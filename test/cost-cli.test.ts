/**
 * Cost subcommand tests: time parsing, rendering, and the routed failure paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import axios from 'axios';
import { parseTime, renderAssessment, runCostCli } from '../src/cost-cli.js';
import { runCli } from '../src/cli-core.js';
import { assessImageCosts, type UsagePage, type ImagesUsageResult, type CostsResult } from '../src/cost.js';
import { logger, setLogLevel } from '../src/utils.js';

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

describe('renderAssessment', () => {
  it('renders the worked example with an unattributed row and a plain-language footer', () => {
    const T0 = 1730419200;
    const images: UsagePage<ImagesUsageResult>[] = [
      {
        object: 'page',
        has_more: false,
        next_page: null,
        data: [
          {
            object: 'bucket',
            start_time: T0,
            end_time: T0 + 86400,
            results: [{ object: 'organization.usage.images.result', images: 2, num_model_requests: 2 }],
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
            results: [{ object: 'organization.costs.result', amount: { currency: 'usd', value: 0.06 } }],
          },
        ],
      },
    ];
    const text = renderAssessment(assessImageCosts(images, costs, { start_time: T0, end_time: T0 + 86400 }));
    expect(text).toContain('2024-11-01  org');
    expect(text).toMatch(/\s2\s+-\s+0\.06 usd\s+0\.06 usd\s+-\s+unattributed/);
    expect(text).toContain('usd: image-classified 0.00, unclassified 0.06, other 0.00, all-API total 0.06');
    expect(text).toContain('co-occurrence is not attribution');
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
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    expect(await runCli(argv('--start', 'banana'), '3.1.0')).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--start: "banana"'));
  });

  it('fails clearly without an admin key', async () => {
    delete process.env.OPENAI_ADMIN_KEY;
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    expect(await runCostCli(argv('--start', '7d'), '3.1.0')).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('OPENAI_ADMIN_KEY not found'));
  });

  it('rejects an end before start', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    expect(await runCostCli(argv('--start', '2024-11-02', '--end', '2024-11-01'), '3.1.0')).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--end must be after --start'));
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
              results: url.includes('/usage/images')
                ? [{ object: 'organization.usage.images.result', images: 2, num_model_requests: 2 }]
                : [{ object: 'organization.costs.result', amount: { currency: 'usd', value: 0.06 } }],
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
    expect(printed.rows[0]?.attribution_level).toBe('unattributed');
    const fs = await import('fs/promises');
    const written = JSON.parse(await fs.readFile(out, 'utf8')) as { classifier_version: string };
    expect(written.classifier_version).toMatch(/^\d{4}-/);
    await fs.rm('./test-cost-out', { recursive: true, force: true });
  });
});
