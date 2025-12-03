/**
 * OpenAI Image Generation API Wrapper
 *
 * Main API wrapper class for interacting with OpenAI's Image Generation API.
 * Supports DALL-E 2, DALL-E 3, and GPT Image 1 models.
 *
 * All generation methods follow a consistent pattern:
 * 1. Verify API key is set
 * 2. Validate parameters
 * 3. Build request payload
 * 4. Submit generation request
 * 5. Return response with image data
 *
 * @example
 * const api = new OpenAIImageAPI();
 * const result = await api.generateImage({
 *   prompt: 'a cat',
 *   model: 'dall-e-3',
 *   size: '1024x1024'
 * });
 */
import type { APIOptions, GenerateImageParams, EditImageParams, VariationImageParams, ImageResponse } from './types.js';
/**
 * Wrapper class for OpenAI Image Generation API.
 *
 * Provides methods to generate, edit, and create variations of images
 * using DALL-E and GPT Image models.
 */
export declare class OpenAIImageAPI {
    private logger;
    private apiKey;
    private baseUrl;
    private rateLimitDelay;
    private lastRequestTime;
    /**
     * Initialize OpenAIImageAPI instance.
     *
     * @param options - Configuration options
     * @param options.apiKey - OpenAI API key. If null, reads from environment.
     * @param options.baseUrl - API base URL (default: https://api.openai.com)
     * @param options.logLevel - Logging level (DEBUG, INFO, WARNING, ERROR)
     * @param options.rateLimitDelay - Minimum milliseconds between API requests (default: 1000)
     */
    constructor({ apiKey, baseUrl, logLevel, rateLimitDelay, }?: APIOptions);
    /**
     * Verify that API key is set.
     *
     * @throws Error If API key is not set
     */
    private _verifyApiKey;
    /**
     * Redact API key for logging purposes.
     *
     * @param apiKey - API key to redact
     * @returns Redacted API key showing only last 4 characters
     */
    private _redactApiKey;
    /**
     * Sanitize error message for production use.
     *
     * @param error - Error object
     * @param status - HTTP status code
     * @returns Sanitized error message
     */
    private _sanitizeErrorMessage;
    /**
     * Make HTTP request to OpenAI API.
     *
     * @param method - HTTP method (GET, POST)
     * @param endpoint - API endpoint path
     * @param data - Request payload
     * @param isMultipart - Whether this is a multipart/form-data request
     * @returns JSON response from API
     */
    private _makeRequest;
    /**
     * Generate image from text prompt.
     *
     * @param params - Generation parameters
     * @returns Generation response with image data
     */
    generateImage(params: GenerateImageParams): Promise<ImageResponse>;
    /**
     * Edit image with prompt.
     *
     * @param params - Edit parameters
     * @returns Edit response with image data
     */
    generateImageEdit(params: EditImageParams): Promise<ImageResponse>;
    /**
     * Create variations of an image.
     *
     * @param params - Variation parameters
     * @returns Variation response with image data
     */
    generateImageVariation(params: VariationImageParams): Promise<ImageResponse>;
    /**
     * Download and save images from API response.
     *
     * @param response - API response object
     * @param outputDir - Directory to save images
     * @param baseFilename - Base filename (without extension)
     * @param format - Image format (png, jpg, webp)
     * @returns Array of saved file paths
     */
    saveImages(response: ImageResponse, outputDir: string, baseFilename: string, format?: string): Promise<string[]>;
}
export { OpenAIVideoAPI } from './video-api.js';
//# sourceMappingURL=api.d.ts.map