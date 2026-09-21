/**
 * `openai-img cost` — the cost-assessment subcommand.
 *
 * Kept apart from the generation CLI so the two option sets do not mix:
 * this one needs an admin key and a date range, nothing else in common.
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
/**
 * Accept a Unix-seconds integer, an ISO-8601 date/time, or `today` /
 * `yesterday` / `Nd` (N days ago, UTC midnight). Returns Unix seconds.
 */
export declare function parseTime(text: string, flag: string, now?: Date): number;
/** Build the subcommand's program */
export declare function buildCostProgram(version: string): Command;
/** Render the whole assessment as text */
export declare function renderAssessment(a: CostAssessment): string;
/**
 * Run `openai-img cost`. Returns the exit code.
 *
 * @param argv - Full argv (node, script, 'cost', ...flags)
 * @param version - Package version for --version
 */
export declare function runCostCli(argv: string[], version: string): Promise<number>;
//# sourceMappingURL=cost-cli.d.ts.map