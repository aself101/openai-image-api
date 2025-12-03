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
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
// Load environment variables in priority order:
// 1. First try local .env in current directory
dotenv.config();
// 2. Then try global config in home directory (if local .env doesn't exist)
const globalConfigPath = join(homedir(), '.openai', '.env');
if (existsSync(globalConfigPath)) {
    dotenv.config({ path: globalConfigPath });
}
// OpenAI API Base URL
export const BASE_URL = 'https://api.openai.com';
// API Endpoints - Images
export const ENDPOINTS = {
    'generate': '/v1/images/generations',
    'edit': '/v1/images/edits',
    'variation': '/v1/images/variations',
};
// API Endpoints - Videos (Sora)
export const VIDEO_ENDPOINTS = {
    'create': '/v1/videos',
    'retrieve': '/v1/videos/{video_id}',
    'content': '/v1/videos/{video_id}/content',
    'remix': '/v1/videos/{video_id}/remix',
    'list': '/v1/videos',
    'delete': '/v1/videos/{video_id}',
};
// Supported models - Images
export const MODELS = {
    'dalle-2': 'dall-e-2',
    'dalle-3': 'dall-e-3',
    'gpt-image-1': 'gpt-image-1',
};
// Supported models - Videos (Sora)
export const VIDEO_MODELS = {
    'sora-2': 'sora-2',
    'sora-2-pro': 'sora-2-pro',
};
// Model-specific parameter constraints
export const MODEL_CONSTRAINTS = {
    'dall-e-2': {
        sizes: ['256x256', '512x512', '1024x1024'],
        promptMaxLength: 1000,
        quality: ['standard'],
        n: { min: 1, max: 10 },
        supportsEdit: true,
        supportsVariation: true,
        responseFormats: ['url', 'b64_json'],
        imageMaxSize: 4 * 1024 * 1024, // 4MB
        imageRequirements: 'square PNG file less than 4MB',
        editMaxImages: 1,
    },
    'dall-e-3': {
        sizes: ['1024x1024', '1792x1024', '1024x1792'],
        promptMaxLength: 4000,
        quality: ['standard', 'hd'],
        n: { min: 1, max: 1 }, // Only n=1 supported
        styles: ['vivid', 'natural'],
        supportsEdit: false,
        supportsVariation: false,
        responseFormats: ['url', 'b64_json'],
    },
    'gpt-image-1': {
        sizes: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
        promptMaxLength: 32000,
        quality: ['auto', 'high', 'medium', 'low'],
        n: { min: 1, max: 10 },
        backgrounds: ['auto', 'transparent', 'opaque'],
        moderation: ['auto', 'low'],
        outputFormats: ['png', 'jpeg', 'webp'],
        outputCompression: { min: 0, max: 100 },
        partialImages: { min: 0, max: 3 },
        inputFidelity: ['high', 'low'],
        supportsEdit: true,
        supportsVariation: false,
        responseFormat: 'b64_json', // Always returns base64
        imageMaxSize: 50 * 1024 * 1024, // 50MB
        imageFormats: ['png', 'webp', 'jpg'],
        editMaxImages: 16,
    },
};
// Video model-specific parameter constraints (Sora)
export const VIDEO_MODEL_CONSTRAINTS = {
    'sora-2': {
        sizes: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
        seconds: [4, 8, 12],
        quality: ['standard'],
        promptMaxLength: 10000,
        pollInterval: 10, // seconds between status checks
        timeout: 1200, // 20 minutes maximum wait time
        statuses: ['queued', 'in_progress', 'completed', 'failed'],
        variants: ['video', 'thumbnail', 'spritesheet'],
        supportsInputReference: true, // Image for first frame
        supportsRemix: true,
        videoMaxSize: 100 * 1024 * 1024, // 100MB max download
        imageReferenceMaxSize: 50 * 1024 * 1024, // 50MB for input_reference
        imageReferenceFormats: ['image/jpeg', 'image/png', 'image/webp'],
    },
    'sora-2-pro': {
        sizes: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
        seconds: [4, 8, 12],
        quality: ['standard'],
        promptMaxLength: 10000,
        pollInterval: 10, // seconds between status checks
        timeout: 1200, // 20 minutes maximum wait time
        statuses: ['queued', 'in_progress', 'completed', 'failed'],
        variants: ['video', 'thumbnail', 'spritesheet'],
        supportsInputReference: true, // Image for first frame
        supportsRemix: true,
        videoMaxSize: 100 * 1024 * 1024, // 100MB max download
        imageReferenceMaxSize: 50 * 1024 * 1024, // 50MB for input_reference
        imageReferenceFormats: ['image/jpeg', 'image/png', 'image/webp'],
    },
};
/**
 * Retrieve OpenAI API key from environment variables or CLI flag.
 *
 * @param cliApiKey - Optional API key passed via CLI flag (highest priority)
 * @returns The OpenAI API key
 * @throws Error If OPENAI_API_KEY is not found in any location
 */
export function getOpenAIApiKey(cliApiKey = null) {
    // Priority order:
    // 1. CLI flag (if provided)
    // 2. Environment variable
    const apiKey = cliApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        const errorMessage = [
            'OPENAI_API_KEY not found. Please provide your API key via one of these methods:',
            '',
            '  1. CLI flag:           openai-img --api-key YOUR_KEY --dalle-3 --prompt "..."',
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
export function validateApiKeyFormat(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
        return false;
    }
    // OpenAI API keys:
    // - Legacy format: sk-[alphanumeric characters]
    // - Project format: sk-proj-[alphanumeric characters]
    // Valid characters: A-Z, a-z, 0-9, underscore, hyphen
    const keyPattern = /^sk-(proj-)?[A-Za-z0-9_-]{40,}$/;
    if (!keyPattern.test(apiKey)) {
        return false;
    }
    return true;
}
/**
 * Get the output directory for generated images.
 *
 * @returns Output directory path
 */
export function getOutputDir() {
    return process.env.OPENAI_OUTPUT_DIR || 'datasets/openai';
}
/**
 * Validate parameters for a specific model.
 *
 * @param model - The model name
 * @param params - Parameters to validate
 * @returns Validation result with valid flag and errors array
 */
export function validateModelParams(model, params) {
    const errors = [];
    const constraints = MODEL_CONSTRAINTS[model];
    if (!constraints) {
        errors.push(`Unknown model: ${model}`);
        return { valid: false, errors };
    }
    // Validate prompt length
    if (params.prompt && params.prompt.length > constraints.promptMaxLength) {
        errors.push(`Prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${model}`);
    }
    // Validate size
    if (params.size && !constraints.sizes.includes(params.size)) {
        errors.push(`Invalid size "${params.size}" for ${model}. Valid sizes: ${constraints.sizes.join(', ')}`);
    }
    // Validate quality
    if (params.quality && constraints.quality && !constraints.quality.includes(params.quality)) {
        errors.push(`Invalid quality "${params.quality}" for ${model}. Valid options: ${constraints.quality.join(', ')}`);
    }
    // Validate n parameter
    if (params.n !== undefined) {
        const { min, max } = constraints.n;
        if (params.n < min || params.n > max) {
            errors.push(`Parameter "n" must be between ${min} and ${max} for ${model}`);
        }
    }
    // Validate style (dall-e-3 only)
    if (params.style && constraints.styles && !constraints.styles.includes(params.style)) {
        errors.push(`Invalid style "${params.style}" for ${model}. Valid styles: ${constraints.styles.join(', ')}`);
    }
    // Validate background (gpt-image-1 only)
    if (params.background && constraints.backgrounds && !constraints.backgrounds.includes(params.background)) {
        errors.push(`Invalid background "${params.background}" for ${model}. Valid options: ${constraints.backgrounds.join(', ')}`);
    }
    // Validate output format (gpt-image-1 only)
    if (params.output_format && constraints.outputFormats && !constraints.outputFormats.includes(params.output_format)) {
        errors.push(`Invalid output_format "${params.output_format}" for ${model}. Valid formats: ${constraints.outputFormats.join(', ')}`);
    }
    // Validate response format
    if (params.response_format && constraints.responseFormats && !constraints.responseFormats.includes(params.response_format)) {
        errors.push(`Invalid response_format "${params.response_format}" for ${model}. Valid formats: ${constraints.responseFormats.join(', ')}`);
    }
    // Validate output compression (gpt-image-1 only)
    if (params.output_compression !== undefined && constraints.outputCompression) {
        const { min, max } = constraints.outputCompression;
        if (params.output_compression < min || params.output_compression > max) {
            errors.push(`output_compression must be between ${min} and ${max}`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
/**
 * Get model constraints for validation and help text.
 *
 * @param model - The model name
 * @returns Model constraints or null if model not found
 */
export function getModelConstraints(model) {
    return MODEL_CONSTRAINTS[model] || null;
}
/**
 * Validate parameters for a specific video model.
 *
 * @param model - The video model name
 * @param params - Parameters to validate
 * @returns Validation result with valid flag and errors array
 */
export function validateVideoParams(model, params) {
    const errors = [];
    const constraints = VIDEO_MODEL_CONSTRAINTS[model];
    if (!constraints) {
        errors.push(`Unknown video model: ${model}`);
        return { valid: false, errors };
    }
    // Validate prompt length
    if (params.prompt && params.prompt.length > constraints.promptMaxLength) {
        errors.push(`Prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${model}`);
    }
    // Validate size
    if (params.size && !constraints.sizes.includes(params.size)) {
        errors.push(`Invalid size "${params.size}" for ${model}. Valid sizes: ${constraints.sizes.join(', ')}`);
    }
    // Validate seconds (duration)
    if (params.seconds !== undefined) {
        const secondsNum = typeof params.seconds === 'string' ? parseInt(params.seconds, 10) : params.seconds;
        if (!constraints.seconds.includes(secondsNum)) {
            errors.push(`Invalid duration "${params.seconds}" for ${model}. Valid durations: ${constraints.seconds.join(', ')} seconds`);
        }
    }
    // Validate quality
    if (params.quality && !constraints.quality.includes(params.quality)) {
        errors.push(`Invalid quality "${params.quality}" for ${model}. Valid options: ${constraints.quality.join(', ')}`);
    }
    // Validate variant (for content download)
    if (params.variant && !constraints.variants.includes(params.variant)) {
        errors.push(`Invalid variant "${params.variant}" for ${model}. Valid variants: ${constraints.variants.join(', ')}`);
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
/**
 * Get video model constraints for validation and help text.
 *
 * @param model - The video model name
 * @returns Video model constraints or null if model not found
 */
export function getVideoModelConstraints(model) {
    return VIDEO_MODEL_CONSTRAINTS[model] || null;
}
//# sourceMappingURL=config.js.map