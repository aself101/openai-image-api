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
import type { ImageModel, ImageModelFamily, ImageModelConstraints, ImageModelConstraintsMap, ModelDeprecation, ValidationResult, GenerateImageParams, EditImageParams, StreamParams, FlexibleSizeConstraint } from './types.js';
/** OpenAI API base URL; override per instance via APIOptions.baseUrl (HTTPS only) */
export declare const BASE_URL: string;
/** Image API endpoint paths, relative to BASE_URL */
export declare const ENDPOINTS: {
    readonly generate: "/v1/images/generations";
    readonly edit: "/v1/images/edits";
};
/**
 * Default model when none is given.
 *
 * Flare is the guide's recommendation for "fast, high-quality everyday image
 * generation"; Sunburst is preferred where editing precision matters. The
 * previous default (`dall-e-2`) was shut down 2026-05-12.
 */
export declare const DEFAULT_MODEL: ImageModelFamily;
/** CLI-friendly names to canonical model identifiers */
export declare const MODELS: {
    readonly sunburst: "gpt-image-2.5-sunburst";
    readonly flare: "gpt-image-2.5-flare";
    readonly 'gpt-image-2': "gpt-image-2";
    readonly 'gpt-image-1.5': "gpt-image-1.5";
    readonly 'gpt-image-1': "gpt-image-1";
    readonly 'gpt-image-1-mini': "gpt-image-1-mini";
};
/** Dated snapshots resolved to the family whose constraints they share */
export declare const MODEL_ALIASES: Record<string, ImageModelFamily>;
/**
 * Announced shutdowns, from developers.openai.com/api/docs/deprecations.
 * Models listed here still work until the date shown; the API class logs a
 * warning the first time each is used.
 */
export declare const MODEL_DEPRECATIONS: Partial<Record<ImageModelFamily, ModelDeprecation>>;
/**
 * Per-family parameter constraints, as published in the API reference.
 * Look up by any accepted identifier through getModelConstraints(), which
 * resolves dated snapshots to their family.
 */
export declare const MODEL_CONSTRAINTS: ImageModelConstraintsMap;
/**
 * Retrieve OpenAI API key from environment variables or CLI flag.
 *
 * @param cliApiKey - Optional API key passed via CLI flag (highest priority)
 * @returns The OpenAI API key
 * @throws Error If OPENAI_API_KEY is not found in any location
 */
export declare function getOpenAIApiKey(cliApiKey?: string | null): string;
/**
 * Validate that the API key appears to be in correct format.
 *
 * @param apiKey - The API key string to validate
 * @returns True if API key format appears valid
 */
export declare function validateApiKeyFormat(apiKey: string | null | undefined): boolean;
/**
 * Get the output directory for generated images.
 *
 * @returns Output directory path
 */
export declare function getOutputDir(): string;
/**
 * The one unknown-model message, so the API class, validator and CLI agree.
 */
export declare function unknownModelMessage(model: string): string;
/**
 * Resolve a model identifier (canonical or dated snapshot) to its family.
 *
 * @param model - Model identifier as the caller supplied it
 * @returns The family, or null if the identifier is not supported
 */
export declare function resolveModelFamily(model: string): ImageModelFamily | null;
/**
 * Whether a string is a model identifier this package will send.
 */
export declare function isSupportedModel(model: string): model is ImageModel;
/**
 * Get model constraints for validation and help text.
 *
 * @param model - Model identifier (canonical or snapshot)
 * @returns Model constraints or null if model not found
 */
export declare function getModelConstraints(model: string): ImageModelConstraints | null;
/**
 * Get the announced deprecation for a model, if any.
 */
export declare function getModelDeprecation(model: string): ModelDeprecation | null;
/**
 * Validate a free-form `WIDTHxHEIGHT` size against a flexible-size rule set.
 *
 * @returns Error messages; empty when the size is acceptable
 */
export declare function validateFlexibleSize(size: string, rule: FlexibleSizeConstraint): string[];
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
export declare function validateModelParams(model: string, params: Partial<GenerateImageParams & EditImageParams & StreamParams>): ValidationResult;
//# sourceMappingURL=config.d.ts.map