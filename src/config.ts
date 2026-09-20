/**
 * OpenAI Image API Configuration
 *
 * Handles authentication, model constraints, and parameter validation.
 *
 * API key can be provided via (in priority order):
 * 1. Command line flag: --api-key
 * 2. Environment variable: OPENAI_API_KEY
 * 3. Local .env file in current directory
 * 4. Global config: ~/.openai/.env (for global npm installs)
 *
 * To obtain an API key:
 * 1. Visit https://platform.openai.com/
 * 2. Create an account or sign in
 * 3. Navigate to API keys section
 * 4. Generate your API key
 *
 * Constraint values below are transcribed from the Image API reference
 * (developers.openai.com/api/reference/resources/images) and the image
 * generation guide as of 2026-09-20. Where the reference is silent the
 * comment says so; do not tighten a constraint the API does not publish.
 */

import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type {
  ImageModel,
  ImageModelFamily,
  ImageModelConstraints,
  ImageModelConstraintsMap,
  ModelDeprecation,
  ValidationResult,
  GenerateImageParams,
  EditImageParams,
  StreamParams,
  FlexibleSizeConstraint,
} from './types.js';

// Load environment variables in priority order:
// 1. First try local .env in current directory
dotenv.config();

// 2. Then try global config in home directory (if local .env doesn't exist)
const globalConfigPath: string = join(homedir(), '.openai', '.env');
if (existsSync(globalConfigPath)) {
  dotenv.config({ path: globalConfigPath });
}

// OpenAI API Base URL
export const BASE_URL: string = 'https://api.openai.com';

// API Endpoints
export const ENDPOINTS: Record<string, string> = {
  generate: '/v1/images/generations',
  edit: '/v1/images/edits',
};

/**
 * Default model when none is given.
 *
 * Flare is the guide's recommendation for "fast, high-quality everyday image
 * generation"; Sunburst is preferred where editing precision matters. The
 * previous default (`dall-e-2`) was shut down 2026-05-12.
 */
export const DEFAULT_MODEL: ImageModelFamily = 'gpt-image-2.5-flare';

/** CLI-friendly names to canonical model identifiers */
export const MODELS: Record<string, ImageModelFamily> = {
  sunburst: 'gpt-image-2.5-sunburst',
  flare: 'gpt-image-2.5-flare',
  'gpt-image-2': 'gpt-image-2',
  'gpt-image-1.5': 'gpt-image-1.5',
  'gpt-image-1': 'gpt-image-1',
  'gpt-image-1-mini': 'gpt-image-1-mini',
};

/** Dated snapshots resolved to the family whose constraints they share */
export const MODEL_ALIASES: Record<string, ImageModelFamily> = {
  'gpt-image-2.5-sunburst-2026-09-08': 'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare-2026-09-08': 'gpt-image-2.5-flare',
  'gpt-image-2-2026-04-21': 'gpt-image-2',
};

/**
 * Announced shutdowns, from developers.openai.com/api/docs/deprecations.
 * Models listed here still work until the date shown; the API class logs a
 * warning the first time each is used.
 */
export const MODEL_DEPRECATIONS: Partial<Record<ImageModelFamily, ModelDeprecation>> = {
  'gpt-image-1': { shutdown: '2026-10-23', replacement: 'gpt-image-2' },
  'gpt-image-1-mini': { shutdown: '2026-12-01', replacement: 'gpt-image-2' },
  'gpt-image-1.5': { shutdown: '2026-12-01', replacement: 'gpt-image-2' },
};

/** Free-form size rules shared by gpt-image-2 and the 2.5 models */
const FLEXIBLE_SIZE: FlexibleSizeConstraint = {
  multipleOf: 16,
  maxEdge: 3840,
  maxAspectRatio: 3,
  pixels: { min: 655_360, max: 8_294_400 },
  experimentalAbovePixels: 2560 * 1440,
};

/** Standard sizes every GPT Image model accepts */
const STANDARD_SIZES = ['1024x1024', '1536x1024', '1024x1536', 'auto'];

/** Constraints common to every GPT Image model */
const GPT_IMAGE_BASE: Omit<ImageModelConstraints, 'sizes' | 'quality' | 'inputFidelity' | 'flexibleSize'> = {
  promptMaxLength: 32000,
  n: { min: 1, max: 10 },
  supportsEdit: true,
  backgrounds: ['auto', 'transparent', 'opaque'],
  moderation: ['auto', 'low'],
  outputFormats: ['png', 'jpeg', 'webp'],
  outputCompression: { min: 0, max: 100 },
  partialImages: { min: 0, max: 3 },
  imageMaxSize: 50 * 1024 * 1024, // 50MB
  imageFormats: ['png', 'webp', 'jpg', 'jpeg'],
  editMaxImages: 16,
};

// Model-specific parameter constraints
export const MODEL_CONSTRAINTS: ImageModelConstraintsMap = {
  'gpt-image-2.5-sunburst': {
    ...GPT_IMAGE_BASE,
    sizes: STANDARD_SIZES,
    flexibleSize: FLEXIBLE_SIZE,
    quality: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    // The reference lists input_fidelity on /edits without excluding 2.5, but
    // the live API answers 400 "does not support the 'input_fidelity'
    // parameter" for both 2.5 models (verified 2026-09-20). Documented for
    // gpt-image-2 only; the behaviour extends to its successors.
    inputFidelity: undefined,
  },
  'gpt-image-2.5-flare': {
    ...GPT_IMAGE_BASE,
    sizes: STANDARD_SIZES,
    flexibleSize: FLEXIBLE_SIZE,
    quality: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    inputFidelity: undefined, // as Sunburst; live-verified 2026-09-20
  },
  'gpt-image-2': {
    ...GPT_IMAGE_BASE,
    sizes: STANDARD_SIZES,
    flexibleSize: FLEXIBLE_SIZE,
    quality: ['auto', 'low', 'medium', 'high'],
    // "For gpt-image-2, omit this parameter; the API doesn't allow changing it"
    inputFidelity: undefined,
  },
  'gpt-image-1.5': {
    ...GPT_IMAGE_BASE,
    sizes: STANDARD_SIZES,
    quality: ['auto', 'low', 'medium', 'high'],
    inputFidelity: ['high', 'low'],
  },
  'gpt-image-1': {
    ...GPT_IMAGE_BASE,
    sizes: STANDARD_SIZES,
    quality: ['auto', 'low', 'medium', 'high'],
    inputFidelity: ['high', 'low'],
  },
  'gpt-image-1-mini': {
    ...GPT_IMAGE_BASE,
    sizes: STANDARD_SIZES,
    quality: ['auto', 'low', 'medium', 'high'],
    inputFidelity: ['high', 'low'],
  },
};

/**
 * Retrieve OpenAI API key from environment variables or CLI flag.
 *
 * @param cliApiKey - Optional API key passed via CLI flag (highest priority)
 * @returns The OpenAI API key
 * @throws Error If OPENAI_API_KEY is not found in any location
 */
export function getOpenAIApiKey(cliApiKey: string | null = null): string {
  // Priority order:
  // 1. CLI flag (if provided)
  // 2. Environment variable
  const apiKey = cliApiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const errorMessage = [
      'OPENAI_API_KEY not found. Please provide your API key via one of these methods:',
      '',
      '  1. CLI flag:           openai-img --api-key YOUR_KEY --prompt "..."',
      '  2. Environment var:    export OPENAI_API_KEY=YOUR_KEY',
      '  3. Local .env file:    Create .env in current directory with OPENAI_API_KEY=YOUR_KEY',
      '  4. Global config:      Create ~/.openai/.env with OPENAI_API_KEY=YOUR_KEY',
      '',
      'Get your API key at https://platform.openai.com/api-keys',
    ].join('\n');

    throw new Error(errorMessage);
  }

  return apiKey;
}

/**
 * Validate that the API key appears to be in correct format.
 *
 * @param apiKey - The API key string to validate
 * @returns True if API key format appears valid
 */
export function validateApiKeyFormat(apiKey: string | null | undefined): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  // OpenAI API keys:
  // - Legacy format: sk-[alphanumeric characters]
  // - Project format: sk-proj-[alphanumeric characters]
  // Valid characters: A-Z, a-z, 0-9, underscore, hyphen
  const keyPattern = /^sk-(proj-)?[A-Za-z0-9_-]{40,}$/;

  return keyPattern.test(apiKey);
}

/**
 * Get the output directory for generated images.
 *
 * @returns Output directory path
 */
export function getOutputDir(): string {
  return process.env.OPENAI_OUTPUT_DIR || 'datasets/openai';
}

/**
 * Resolve a model identifier (canonical or dated snapshot) to its family.
 *
 * @param model - Model identifier as the caller supplied it
 * @returns The family, or null if the identifier is not supported
 */
export function resolveModelFamily(model: string): ImageModelFamily | null {
  if (model in MODEL_CONSTRAINTS) {
    return model as ImageModelFamily;
  }
  return MODEL_ALIASES[model] ?? null;
}

/**
 * Whether a string is a model identifier this package will send.
 */
export function isSupportedModel(model: string): model is ImageModel {
  return resolveModelFamily(model) !== null;
}

/**
 * Get model constraints for validation and help text.
 *
 * @param model - Model identifier (canonical or snapshot)
 * @returns Model constraints or null if model not found
 */
export function getModelConstraints(model: string): ImageModelConstraints | null {
  const family = resolveModelFamily(model);
  return family ? MODEL_CONSTRAINTS[family] : null;
}

/**
 * Get the announced deprecation for a model, if any.
 */
export function getModelDeprecation(model: string): ModelDeprecation | null {
  const family = resolveModelFamily(model);
  return family ? (MODEL_DEPRECATIONS[family] ?? null) : null;
}

/**
 * Validate a free-form `WIDTHxHEIGHT` size against a flexible-size rule set.
 *
 * @returns Error messages; empty when the size is acceptable
 */
export function validateFlexibleSize(size: string, rule: FlexibleSizeConstraint): string[] {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) {
    return [`Size "${size}" must be "auto" or WIDTHxHEIGHT (e.g. 1536x864)`];
  }

  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  const errors: string[] = [];

  if (width % rule.multipleOf !== 0 || height % rule.multipleOf !== 0) {
    errors.push(`Size "${size}": width and height must both be multiples of ${rule.multipleOf}`);
  }
  if (width > rule.maxEdge || height > rule.maxEdge) {
    errors.push(`Size "${size}": neither edge may exceed ${rule.maxEdge}px`);
  }

  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (short === 0 || long / short > rule.maxAspectRatio) {
    errors.push(
      `Size "${size}": aspect ratio must be between 1:${rule.maxAspectRatio} and ${rule.maxAspectRatio}:1`
    );
  }

  const pixels = width * height;
  if (pixels < rule.pixels.min || pixels > rule.pixels.max) {
    errors.push(
      `Size "${size}": total pixels (${pixels.toLocaleString()}) must be between ` +
        `${rule.pixels.min.toLocaleString()} and ${rule.pixels.max.toLocaleString()}`
    );
  }

  return errors;
}

/**
 * Validate parameters for a specific model.
 *
 * Accepts generation, edit, and streaming parameter shapes; fields a shape does
 * not carry are simply absent and skipped.
 *
 * @param model - The model identifier
 * @param params - Parameters to validate
 * @returns Validation result with valid flag and errors array
 */
export function validateModelParams(
  model: string,
  params: Partial<GenerateImageParams & EditImageParams & StreamParams>
): ValidationResult {
  const errors: string[] = [];
  const constraints = getModelConstraints(model);

  if (!constraints) {
    errors.push(`Unknown model: ${model}`);
    return { valid: false, errors };
  }

  // Validate prompt length
  if (params.prompt && params.prompt.length > constraints.promptMaxLength) {
    errors.push(
      `Prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${model}`
    );
  }

  // Validate size: enumerated list first, then free-form rules where permitted
  if (params.size && !constraints.sizes.includes(params.size)) {
    if (constraints.flexibleSize) {
      errors.push(...validateFlexibleSize(params.size, constraints.flexibleSize));
    } else {
      errors.push(
        `Invalid size "${params.size}" for ${model}. Valid sizes: ${constraints.sizes.join(', ')}`
      );
    }
  }

  // Validate quality
  if (params.quality && !constraints.quality.includes(params.quality)) {
    errors.push(
      `Invalid quality "${params.quality}" for ${model}. Valid options: ${constraints.quality.join(', ')}`
    );
  }

  // Validate n parameter
  if (params.n !== undefined) {
    const { min, max } = constraints.n;
    if (!Number.isInteger(params.n) || params.n < min || params.n > max) {
      errors.push(`Parameter "n" must be an integer between ${min} and ${max} for ${model}`);
    }
  }

  // Validate background
  if (params.background && !constraints.backgrounds.includes(params.background)) {
    errors.push(
      `Invalid background "${params.background}" for ${model}. Valid options: ${constraints.backgrounds.join(', ')}`
    );
  }

  // Validate output format
  if (params.output_format && !constraints.outputFormats.includes(params.output_format)) {
    errors.push(
      `Invalid output_format "${params.output_format}" for ${model}. Valid formats: ${constraints.outputFormats.join(', ')}`
    );
  }

  // Transparent backgrounds are only encodable as png or webp
  if (params.background === 'transparent' && params.output_format === 'jpeg') {
    errors.push('background "transparent" requires output_format "png" or "webp"');
  }

  // Validate output compression
  if (params.output_compression !== undefined) {
    const { min, max } = constraints.outputCompression;
    if (params.output_compression < min || params.output_compression > max) {
      errors.push(`output_compression must be between ${min} and ${max}`);
    }
    // The reference scopes this parameter to webp/jpeg. png is the default, so
    // an unspecified format with compression set is also a png request.
    if (!params.output_format || params.output_format === 'png') {
      errors.push('output_compression requires output_format "jpeg" or "webp"');
    }
  }

  // Validate moderation
  if (params.moderation && !constraints.moderation.includes(params.moderation)) {
    errors.push(
      `Invalid moderation "${params.moderation}" for ${model}. Valid options: ${constraints.moderation.join(', ')}`
    );
  }

  // Validate input fidelity (edits)
  if (params.input_fidelity !== undefined) {
    if (!constraints.inputFidelity) {
      errors.push(`input_fidelity is not accepted by ${model}; it processes inputs at high fidelity automatically`);
    } else if (!constraints.inputFidelity.includes(params.input_fidelity)) {
      errors.push(
        `Invalid input_fidelity "${params.input_fidelity}" for ${model}. Valid options: ${constraints.inputFidelity.join(', ')}`
      );
    }
  }

  // Validate partial images (streaming)
  if (params.partial_images !== undefined) {
    const { min, max } = constraints.partialImages;
    if (
      !Number.isInteger(params.partial_images) ||
      params.partial_images < min ||
      params.partial_images > max
    ) {
      errors.push(`partial_images must be an integer between ${min} and ${max}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
