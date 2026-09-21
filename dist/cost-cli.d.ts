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
import type { CostAssessment } from './cost.js';
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
/** Unix seconds of the UTC midnight at or before `unix` */
export declare const floorToUtcDay: (unix: number) => number;
/** Unix seconds of the UTC midnight at or after `unix` */
export declare const ceilToUtcDay: (unix: number) => number;
/**
 * Accept a Unix-seconds integer, an ISO-8601 date/time, or `today` /
 * `yesterday` / `Nd` (N days ago, UTC midnight). Returns Unix seconds.
 */
export declare function parseTime(text: string, flag: string, now?: Date): number;
/**
 * Resolve `--start` / `--end` into the UTC-day-aligned range the endpoints
 * will answer for. `end` defaults to the end of the current UTC day.
 */
export declare function resolveRange(startText: string, endText: string, now?: Date): {
    start_time: number;
    end_time: number;
    snapped: boolean;
};
/** Build the subcommand's program */
export declare function buildCostProgram(version: string): Command;
/** Render the whole assessment as text */
export declare function renderAssessment(a: CostAssessment, now?: Date): string;
/**
 * Run `openai-img cost`. Returns the exit code.
 *
 * @param argv - Full argv (node, script, 'cost', ...flags)
 * @param version - Package version for --version
 */
export declare function runCostCli(argv: string[], version: string): Promise<number>;
//# sourceMappingURL=cost-cli.d.ts.map