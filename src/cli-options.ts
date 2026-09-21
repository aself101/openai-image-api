/**
 * Flag-value helpers shared by every CLI surface in the package.
 *
 * Commander hands back untyped values; these narrow them with a membership or
 * shape check so `--quality bogus` fails with the allowed set instead of
 * type-checking as a literal union. cli-core.ts and cost-cli.ts both import
 * from here (cli-core imports cost-cli, so the helpers cannot live in either).
 */

import type {
  ImageBackground,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  InputFidelity,
  LogLevel,
} from './types.js';

export const LOG_LEVELS: readonly LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
export const QUALITIES: readonly ImageQuality[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
export const BACKGROUNDS: readonly ImageBackground[] = ['auto', 'transparent', 'opaque'];
export const MODERATIONS: readonly ImageModeration[] = ['auto', 'low'];
export const OUTPUT_FORMATS: readonly ImageOutputFormat[] = ['png', 'jpeg', 'webp'];
export const INPUT_FIDELITIES: readonly InputFidelity[] = ['high', 'low'];

/** Render an arbitrary flag value for an error message without '[object Object]' */
export function describeValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return value.toString();
    case 'symbol':
      return value.toString();
    case 'undefined':
      return 'undefined';
    default:
      return JSON.stringify(value) ?? 'undefined';
  }
}

/**
 * Narrow a raw flag value to one of an allowed set, or fail with the set.
 *
 * Commander hands back untyped strings; casting them to the literal unions the
 * API expects would let `--quality bogus` type-check. Membership is checked
 * here so the value is genuinely narrowed. Per-model rules (e.g. `max` only on
 * 2.5) are still enforced by validateModelParams downstream.
 */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid value "${describeValue(value)}" for ${flag}. Valid options: ${allowed.join(', ')}`);
}

/** Read an optional string flag */
export function optString(value: unknown, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw new Error(`${flag} expects a string`);
}

/** Read an optional integer flag (commander's parseInt yields NaN on junk) */
export function optInt(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw new Error(`${flag} expects an integer`);
}

/** Read a repeatable string flag */
export function stringList(value: unknown, flag: string): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  throw new Error(`${flag} expects one or more strings`);
}
