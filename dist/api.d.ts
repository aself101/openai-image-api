/**
 * OpenAI Image API Wrapper
 *
 * Main API wrapper class for interacting with OpenAI's Image API using the
 * GPT Image model family (gpt-image-2.5-sunburst, gpt-image-2.5-flare,
 * gpt-image-2, and the deprecated gpt-image-1.5 / gpt-image-1 / gpt-image-1-mini).
 *
 * All generation methods follow a consistent pattern:
 * 1. Verify API key is set
 * 2. Validate parameters against the model's published constraints
 * 3. Build request payload (JSON for generations, multipart for edits)
 * 4. Submit request — buffered, or streamed as Server-Sent Events
 * 5. Return response with base64 image data
 *
 * @example
 * const api = new OpenAIImageAPI();
 * const result = await api.generateImage({
 *   prompt: 'a cat',
 *   model: 'gpt-image-2.5-flare',
 *   size: '1536x1024',
 *   quality: 'high',
 * });
 * await api.saveImages(result, './out', 'cat');
 */
import type { APIOptions, GenerateImageParams, EditImageParams, StreamImageParams, StreamEditImageParams, StreamHandlers, ImageResponse, ImageGenerationStreamEvent, ImageEditStreamEvent } from './types.js';
export type * from './types.js';
/**
 * Wrapper class for the OpenAI Image API.
 *
 * Provides methods to generate and edit images with GPT Image models, with
 * buffered and streaming (partial-image) variants of each.
 */
export declare class OpenAIImageAPI {
    private logger;
    private apiKey;
    private baseUrl;
    private rateLimitDelay;
    private requestTimeout;
    private lastRequestTime;
    /** Models already warned about, so a batch does not repeat the notice */
    private deprecationWarned;
    /**
     * Initialize OpenAIImageAPI instance.
     *
     * @param options - Configuration options
     * @param options.apiKey - OpenAI API key. If null, reads from environment.
     * @param options.baseUrl - API base URL (default: https://api.openai.com)
     * @param options.logLevel - Logging level (DEBUG, INFO, WARNING, ERROR)
     * @param options.rateLimitDelay - Minimum milliseconds between API requests (default: 1000)
     * @param options.requestTimeout - Per-request timeout in milliseconds (default: 180000)
     */
    constructor({ apiKey, baseUrl, logLevel, rateLimitDelay, requestTimeout, }?: APIOptions);
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
     * Log a one-time warning when a model with an announced shutdown is used.
     */
    private _warnIfDeprecated;
    /**
     * Sanitize error message for production use.
     *
     * @param error - Error object
     * @param status - HTTP status code
     * @returns Sanitized error message
     */
    private _sanitizeErrorMessage;
    /**
     * Translate an axios failure into the package's error vocabulary.
     *
     * @param error - Whatever axios rejected with
     * @throws Error Always
     */
    private _throwApiError;
    /**
     * Enforce the minimum delay between requests, then stamp this one.
     */
    private _rateLimit;
    /**
     * Build request headers, merging multipart boundary headers when present.
     */
    private _headers;
    /**
     * Make a buffered HTTP request to the OpenAI API.
     *
     * @param method - HTTP method (GET, POST)
     * @param endpoint - API endpoint path
     * @param data - Request payload
     * @param isMultipart - Whether this is a multipart/form-data request
     * @returns JSON response from API
     */
    private _makeRequest;
    /**
     * Make a streaming POST to the OpenAI API and yield parsed SSE events.
     *
     * On a non-2xx status axios rejects with `response.data` as a Readable; the
     * body is drained and parsed so the API's own error message reaches the
     * caller instead of `[object Object]`.
     *
     * @param endpoint - API endpoint path
     * @param data - Request payload
     * @param isMultipart - Whether this is a multipart/form-data request
     */
    private _makeStreamRequest;
    /**
     * Build the JSON payload for a generation request.
     */
    private _buildGeneratePayload;
    /**
     * Build the multipart form for an edit request.
     *
     * Images are appended under `image[]` for every GPT Image model — the
     * reference's own curl examples use that key with gpt-image-1.5.
     */
    private _buildEditForm;
    /**
     * Shared pre-flight for generation requests.
     */
    private _prepareGenerate;
    /**
     * Shared pre-flight for edit requests.
     */
    private _prepareEdit;
    /**
     * Convert a terminal stream event into the buffered response shape, so
     * streaming and non-streaming callers can share `saveImages`.
     */
    private _completedToResponse;
    /**
     * Generate image from text prompt.
     *
     * @param params - Generation parameters
     * @returns Generation response with base64 image data
     */
    generateImage(params: GenerateImageParams): Promise<ImageResponse>;
    /**
     * Generate an image, streaming partial frames as they render.
     *
     * Yields `image_generation.partial_image` events (0 to `partial_images` of
     * them) followed by one `image_generation.completed` event carrying the
     * final image and usage.
     *
     * @param params - Generation parameters plus `partial_images`
     */
    streamImage(params: StreamImageParams): AsyncGenerator<ImageGenerationStreamEvent>;
    /**
     * Generate an image with streaming, invoking a callback per partial frame
     * and resolving to the final image in the buffered response shape.
     *
     * @param params - Generation parameters plus `partial_images`
     * @param handlers - Optional `onPartialImage` callback
     * @returns The completed image as an ImageResponse
     * @throws Error If the stream ends without a completed event
     */
    generateImageStream(params: StreamImageParams, handlers?: StreamHandlers): Promise<ImageResponse>;
    /**
     * Edit image(s) with prompt.
     *
     * @param params - Edit parameters
     * @returns Edit response with base64 image data
     */
    generateImageEdit(params: EditImageParams): Promise<ImageResponse>;
    /**
     * Edit image(s), streaming partial frames as they render.
     *
     * Yields `image_edit.partial_image` events followed by one
     * `image_edit.completed` event.
     *
     * @param params - Edit parameters plus `partial_images`
     */
    streamImageEdit(params: StreamEditImageParams): AsyncGenerator<ImageEditStreamEvent>;
    /**
     * Edit image(s) with streaming, invoking a callback per partial frame and
     * resolving to the final image in the buffered response shape.
     *
     * @param params - Edit parameters plus `partial_images`
     * @param handlers - Optional `onPartialImage` callback
     * @returns The completed image as an ImageResponse
     * @throws Error If the stream ends without a completed event
     */
    generateImageEditStream(params: StreamEditImageParams, handlers?: StreamHandlers): Promise<ImageResponse>;
    /**
     * Decode and save images from an API response.
     *
     * @param response - API response object
     * @param outputDir - Directory to save images
     * @param baseFilename - Base filename (without extension)
     * @param format - Image format (png, jpeg, webp). Defaults to the response's
     *   `output_format`, then png.
     * @returns Array of saved file paths
     */
    saveImages(response: ImageResponse, outputDir: string, baseFilename: string, format?: string): Promise<string[]>;
}
//# sourceMappingURL=api.d.ts.map