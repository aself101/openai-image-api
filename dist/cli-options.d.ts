/**
 * Flag-value helpers shared by every CLI surface in the package.
 *
 * Commander hands back untyped values; these narrow them with a membership or
 * shape check so `--quality bogus` fails with the allowed set instead of
 * type-checking as a literal union. cli-core.ts and cost-cli.ts both import
 * from here (cli-core imports cost-cli, so the helpers cannot live in either).
 */
import type { ImageBackground, ImageModeration, ImageOutputFormat, ImageQuality, InputFidelity, LogLevel } from './types.js';
export declare const LOG_LEVELS: readonly LogLevel[];
export declare const QUALITIES: readonly ImageQuality[];
export declare const BACKGROUNDS: readonly ImageBackground[];
export declare const MODERATIONS: readonly ImageModeration[];
export declare const OUTPUT_FORMATS: readonly ImageOutputFormat[];
export declare const INPUT_FIDELITIES: readonly InputFidelity[];
/** Render an arbitrary flag value for an error message without '[object Object]' */
export declare function describeValue(value: unknown): string;
/**
 * Narrow a raw flag value to one of an allowed set, or fail with the set.
 *
 * Commander hands back untyped strings; casting them to the literal unions the
 * API expects would let `--quality bogus` type-check. Membership is checked
 * here so the value is genuinely narrowed. Per-model rules (e.g. `max` only on
 * 2.5) are still enforced by validateModelParams downstream.
 */
export declare function oneOf<T extends string>(value: unknown, allowed: readonly T[], flag: string): T | undefined;
/** Read an optional string flag */
export declare function optString(value: unknown, flag: string): string | undefined;
/** Read an optional integer flag (commander's parseInt yields NaN on junk) */
export declare function optInt(value: unknown, flag: string): number | undefined;
/** Read a repeatable string flag */
export declare function stringList(value: unknown, flag: string): string[];
//# sourceMappingURL=cli-options.d.ts.map