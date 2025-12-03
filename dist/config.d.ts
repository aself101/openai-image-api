/**
 * OpenAI Image Generation API Configuration
 *
 * Handles authentication and API configuration settings.
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
 */
import type { ImageModel, VideoModel, ImageModelConstraints, VideoModelConstraints, ImageModelConstraintsMap, VideoModelConstraintsMap, ValidationResult, GenerateImageParams, CreateVideoParams } from './types.js';
export declare const BASE_URL: string;
export declare const ENDPOINTS: Record<string, string>;
export declare const VIDEO_ENDPOINTS: Record<string, string>;
export declare const MODELS: Record<string, ImageModel>;
export declare const VIDEO_MODELS: Record<string, VideoModel>;
export declare const MODEL_CONSTRAINTS: ImageModelConstraintsMap;
export declare const VIDEO_MODEL_CONSTRAINTS: VideoModelConstraintsMap;
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
 * Validate parameters for a specific model.
 *
 * @param model - The model name
 * @param params - Parameters to validate
 * @returns Validation result with valid flag and errors array
 */
export declare function validateModelParams(model: string, params: Partial<GenerateImageParams>): ValidationResult;
/**
 * Get model constraints for validation and help text.
 *
 * @param model - The model name
 * @returns Model constraints or null if model not found
 */
export declare function getModelConstraints(model: string): ImageModelConstraints | null;
/**
 * Validate parameters for a specific video model.
 *
 * @param model - The video model name
 * @param params - Parameters to validate
 * @returns Validation result with valid flag and errors array
 */
export declare function validateVideoParams(model: string, params: Partial<CreateVideoParams> & {
    variant?: string;
}): ValidationResult;
/**
 * Get video model constraints for validation and help text.
 *
 * @param model - The video model name
 * @returns Video model constraints or null if model not found
 */
export declare function getVideoModelConstraints(model: string): VideoModelConstraints | null;
//# sourceMappingURL=config.d.ts.map