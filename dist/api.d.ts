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
import type { APIOptions, GenerateImageParams, EditImageParams, StreamImageParams, StreamEditImageParams, StreamHandlers, ImageModel, ImageResponse, ImageGenerationStreamEvent, ImageEditStreamEvent } from './types.js';
export type * from './types.js';
/**
 * Error thrown for every failed API interaction.
 *
 * `message` is the package's stable, human-readable vocabulary (kept from
 * 2.x). The fields carry what a consumer needs to branch on without parsing
 * the message: the HTTP `status`, and the API body's `code`/`type` when
 * present — the guide names `error.code` as the stable discriminator and
 * `image_generation_user_error` as the type for prompt/input problems that
 * must not be retried unchanged. `cause` is the original axios error.
 */
export declare class OpenAIImageAPIError extends Error {
    /** HTTP status, when the API answered at all */
    readonly status?: number;
    /** `error.code` from the API body, when present */
    readonly code?: string;
    /**
     * `error.type` from the API body when the API answered; otherwise one of the
     * package's own: `validation_error` (rejected by the client-side constraint
     * check), `input_error` (an input file failed the pre-upload check),
     * `configuration_error` (no API key), `stream_error` (terminal error event
     * or early stream end). `status` is undefined for all four.
     */
    readonly type?: string;
    /**
     * `error.message` from the API body, when present — deliberately NOT subject
     * to the `NODE_ENV=production` sanitization applied to `message`. That
     * sanitization protects a server's end users from internal detail; the key
     * holder reading this field is the party the API's message is addressed to,
     * and OpenAI's error text names the rejected parameter or policy, not
     * internal paths. Do not forward it to end users unreviewed.
     */
    readonly apiMessage?: string;
    constructor(message: string, details?: {
        status?: number;
        code?: string;
        type?: string;
        apiMessage?: string;
        cause?: unknown;
    });
}
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
    private skipValidation;
    private lastRequestTime;
    /**
     * Serializes rate-limit waits. Without it, concurrent callers on one
     * instance all read the same lastRequestTime, sleep the same delay, and fire
     * together — the burst the limiter exists to prevent.
     */
    private rateLimitQueue;
    /** Models already warned about, so a batch does not repeat the notice */
    private deprecationWarned;
    /**
     * Initialize OpenAIImageAPI instance.
     *
     * @param options - Configuration options
     * @param options.apiKey - OpenAI API key. If null, reads from environment.
     * @param options.baseUrl - API base URL (default: https://api.openai.com)
     * @param options.logLevel - Logging level (DEBUG, INFO, WARNING, ERROR). Default WARNING: a library
     *   should not write progress lines to a host's stdout unasked. The CLI sets INFO explicitly.
     * @param options.rateLimitDelay - Minimum milliseconds between API requests (default: 1000)
     * @param options.requestTimeout - Per-request timeout in milliseconds (default: 180000)
     * @param options.skipValidation - Send requests without the client-side constraint check (default: false)
     */
    constructor({ apiKey, baseUrl, logLevel, rateLimitDelay, requestTimeout, skipValidation, }?: APIOptions);
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
     * Build request headers; multipart bodies supply their own Content-Type
     * (with boundary) via form-data.
     */
    private _headers;
    /**
     * Make a buffered HTTP request to the OpenAI API.
     *
     * @param method - HTTP method (GET, POST)
     * @param endpoint - API endpoint path
     * @param body - Request body, or null for GET
     * @param options.rateLimited - The caller already awaited _rateLimit() (edits
     *   do, so input files are opened after the sleep rather than held across it)
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
     * @param body - Request body
     * @param options.rateLimited - The caller already awaited _rateLimit()
     */
    private _makeStreamRequest;
    /**
     * Build the JSON payload for a generation request.
     */
    private _buildGeneratePayload;
    /**
     * Build the multipart form for an edit request from inputs already opened
     * and validated. Each part streams from the validated handle (the same
     * descriptor whose header was checked), with an explicit filename, content
     * type and length so form-data derives nothing from the path.
     *
     * Images are appended under `image[]` for every GPT Image model — the
     * reference's own curl examples use that key with gpt-image-1.5.
     */
    private _buildEditForm;
    /** Throw a client-side rejection in the package's error vocabulary */
    private _reject;
    /**
     * Run the constraint check unless the caller opted out. In skip mode the
     * request is sent as-is and the API's own answer is what the caller gets.
     */
    private _validate;
    /**
     * Shared pre-flight for generation requests.
     */
    private _prepareGenerate;
    /**
     * Shared pre-flight for edit requests: parameter checks only, no filesystem.
     */
    private _prepareEdit;
    /**
     * Open and validate every input file for an edit. Called after the rate-limit
     * sleep so descriptors are not held across it. On any failure every handle
     * opened so far is closed before the error propagates.
     */
    private _openEditInputs;
    /** Release every handle an edit opened; harmless when streams already closed them */
    private _closeEditInputs;
    /**
     * Convert a terminal stream event into the buffered response shape, so
     * streaming and non-streaming callers can share `saveImages`.
     */
    private _completedToResponse;
    /**
     * Run every check a real request would run, without sending it: API key
     * present, prompt present, parameters against the model's constraints (unless
     * skipValidation), and for edits every input file opened, size- and
     * header-checked, then closed. Rejects with the same OpenAIImageAPIError the
     * request would have. The CLI's --dry-run is this method.
     *
     * @param params - Generation or edit parameters
     * @param options.streaming - Apply the streaming rules (n must be 1, partial_images 0-3)
     * @returns The resolved model id
     * @throws OpenAIImageAPIError Exactly what the corresponding request would throw before sending
     * @example
     * await api.validateRequest({ image: 'photo.png', prompt: 'x', model: 'gpt-image-2', size: '2048x1152' });
     */
    validateRequest(params: StreamImageParams | StreamEditImageParams, options?: {
        streaming?: boolean;
    }): Promise<ImageModel>;
    /**
     * Generate image from text prompt.
     *
     * @param params - Generation parameters
     * @returns Generation response with base64 image data
     * @throws OpenAIImageAPIError With `type: 'validation_error'` for a client-side
     *   rejection, or `status`/`code` from the API's own error response
     * @example
     * const result = await api.generateImage({
     *   prompt: 'a lighthouse in a storm',
     *   model: 'gpt-image-2.5-sunburst',
     *   size: '1536x1024',
     *   quality: 'high',
     *   output_format: 'webp',
     *   output_compression: 80,
     * });
     * await api.saveImages(result, './out', 'lighthouse');
     */
    generateImage(params: GenerateImageParams): Promise<ImageResponse>;
    /**
     * Generate an image, streaming partial frames as they render.
     *
     * Yields `image_generation.partial_image` events (0 to `partial_images` of
     * them) followed by one `image_generation.completed` event carrying the
     * final image and usage. Breaking out of the loop early destroys the
     * response stream.
     *
     * @param params - Generation parameters plus `partial_images`
     * @yields Partial-image events, then the completed event
     * @throws OpenAIImageAPIError With `type: 'stream_error'` for a terminal error
     *   event, or the usual request/validation errors
     * @example
     * for await (const event of api.streamImage({ prompt: 'a storm', partial_images: 2 })) {
     *   if (event.type === 'image_generation.partial_image') {
     *     await fs.promises.writeFile(`partial-${event.partial_image_index}.png`, Buffer.from(event.b64_json, 'base64'));
     *   } else {
     *     await fs.promises.writeFile('final.png', Buffer.from(event.b64_json, 'base64'));
     *   }
     * }
     */
    streamImage(params: StreamImageParams): AsyncGenerator<ImageGenerationStreamEvent>;
    /**
     * Generate an image with streaming, invoking a callback per partial frame
     * and resolving to the final image in the buffered response shape.
     *
     * @param params - Generation parameters plus `partial_images`
     * @param handlers - Optional `onPartialImage` callback
     * @returns The completed image as an ImageResponse
     * @throws OpenAIImageAPIError With `type: 'stream_error'` if the stream ends without a completed event
     * @example
     * const result = await api.generateImageStream(
     *   { prompt: 'a storm', partial_images: 2 },
     *   { onPartialImage: (e) => console.log(`partial ${e.partial_image_index}`) }
     * );
     * await api.saveImages(result, './out', 'storm');
     */
    generateImageStream(params: StreamImageParams, handlers?: StreamHandlers): Promise<ImageResponse>;
    /**
     * Edit image(s) with prompt.
     *
     * Every input file is opened, size- and header-checked before upload, and
     * uploaded from that same open handle.
     *
     * @param params - Edit parameters
     * @returns Edit response with base64 image data
     * @throws OpenAIImageAPIError With `type: 'input_error'` when an input file is
     *   missing, too large or not a PNG/JPEG/WebP; `'validation_error'` for a
     *   parameter the model rejects; or `status`/`code` from the API
     * @example
     * const result = await api.generateImageEdit({
     *   image: ['lotion.png', 'soap.png'],
     *   mask: 'basket-mask.png',
     *   prompt: 'arrange these in a gift basket',
     *   model: 'gpt-image-2.5-sunburst',
     * });
     */
    generateImageEdit(params: EditImageParams): Promise<ImageResponse>;
    /**
     * Edit image(s), streaming partial frames as they render.
     *
     * Yields `image_edit.partial_image` events followed by one
     * `image_edit.completed` event.
     *
     * @param params - Edit parameters plus `partial_images`
     * @yields Partial-image events, then the completed event
     * @throws OpenAIImageAPIError As generateImageEdit, plus `type: 'stream_error'`
     * @example
     * for await (const event of api.streamImageEdit({ image: 'photo.png', prompt: 'make it autumn', partial_images: 1 })) {
     *   if (event.type === 'image_edit.completed') console.log(event.usage);
     * }
     */
    streamImageEdit(params: StreamEditImageParams): AsyncGenerator<ImageEditStreamEvent>;
    /**
     * Edit image(s) with streaming, invoking a callback per partial frame and
     * resolving to the final image in the buffered response shape.
     *
     * @param params - Edit parameters plus `partial_images`
     * @param handlers - Optional `onPartialImage` callback
     * @returns The completed image as an ImageResponse
     * @throws OpenAIImageAPIError With `type: 'stream_error'` if the stream ends without a completed event
     * @example
     * const edited = await api.generateImageEditStream(
     *   { image: 'photo.png', prompt: 'make it autumn', partial_images: 1 },
     *   { onPartialImage: (e) => console.log(`preview ${e.partial_image_index}`) }
     * );
     */
    generateImageEditStream(params: StreamEditImageParams, handlers?: StreamHandlers): Promise<ImageResponse>;
    /**
     * Decode and save images from an API response.
     *
     * Both path inputs are checked before anything is written: `outputDir` may
     * not contain a `..` segment, and `baseFilename` must be a single path
     * component (no separators, not `.`/`..`). A server that forwards end-user
     * input into this method therefore cannot be steered outside `outputDir`.
     * Callers who need to write elsewhere should use `decodeBase64Image` with a
     * path they have validated themselves.
     *
     * @param response - API response object
     * @param outputDir - Directory to save images (created if missing)
     * @param baseFilename - Base filename (without extension); one path component
     * @param format - Image format (png, jpeg, webp). Defaults to the response's
     *   `output_format`, then png.
     * @returns Array of saved file paths
     * @throws Error If outputDir contains a `..` segment or baseFilename is not a single component
     * @example
     * const paths = await api.saveImages(result, './renders', 'lighthouse');
     * // n=1 → ['./renders/lighthouse.png']; n=3 → lighthouse_1.png, _2, _3
     */
    saveImages(response: ImageResponse, outputDir: string, baseFilename: string, format?: string): Promise<string[]>;
}
//# sourceMappingURL=api.d.ts.map