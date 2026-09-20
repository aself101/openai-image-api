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
import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import winston from 'winston';
import { getOpenAIApiKey, BASE_URL, ENDPOINTS, DEFAULT_MODEL, validateModelParams, getModelConstraints, getModelDeprecation, } from './config.js';
import { decodeBase64Image, parseSSEStream, readStreamToString } from './utils.js';
/** Default per-request timeout; see APIOptions.requestTimeout for rationale */
const DEFAULT_REQUEST_TIMEOUT = 180_000;
/**
 * Wrapper class for the OpenAI Image API.
 *
 * Provides methods to generate and edit images with GPT Image models, with
 * buffered and streaming (partial-image) variants of each.
 */
export class OpenAIImageAPI {
    logger;
    apiKey;
    baseUrl;
    rateLimitDelay;
    requestTimeout;
    lastRequestTime;
    /** Models already warned about, so a batch does not repeat the notice */
    deprecationWarned;
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
    constructor({ apiKey = null, baseUrl = BASE_URL, logLevel = 'INFO', rateLimitDelay = 1000, requestTimeout = DEFAULT_REQUEST_TIMEOUT, } = {}) {
        // Setup logging
        this.logger = winston.createLogger({
            level: logLevel.toLowerCase(),
            format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} - ${level.toUpperCase()} - ${message}`;
            })),
            transports: [new winston.transports.Console()],
        });
        // Validate baseUrl uses HTTPS
        if (baseUrl && !baseUrl.startsWith('https://')) {
            throw new Error('API base URL must use HTTPS protocol for security');
        }
        // Set API key
        this.apiKey = apiKey || getOpenAIApiKey();
        this.baseUrl = baseUrl;
        // Rate limiting and timeouts
        this.rateLimitDelay = rateLimitDelay;
        this.requestTimeout = requestTimeout;
        this.lastRequestTime = 0;
        this.deprecationWarned = new Set();
        this.logger.info('OpenAIImageAPI initialized successfully');
    }
    /**
     * Verify that API key is set.
     *
     * @throws Error If API key is not set
     */
    _verifyApiKey() {
        if (!this.apiKey) {
            throw new Error('API key not set. Please provide apiKey during initialization ' +
                'or set OPENAI_API_KEY environment variable.');
        }
    }
    /**
     * Redact API key for logging purposes.
     *
     * @param apiKey - API key to redact
     * @returns Redacted API key showing only last 4 characters
     */
    _redactApiKey(apiKey) {
        if (!apiKey || apiKey.length < 8) {
            return '[REDACTED]';
        }
        return `sk-...${apiKey.slice(-4)}`;
    }
    /**
     * Log a one-time warning when a model with an announced shutdown is used.
     */
    _warnIfDeprecated(model) {
        const deprecation = getModelDeprecation(model);
        if (!deprecation || this.deprecationWarned.has(model))
            return;
        this.deprecationWarned.add(model);
        this.logger.warn(`Model ${model} is scheduled for removal from the OpenAI API on ${deprecation.shutdown}. ` +
            `Migrate to ${deprecation.replacement}.`);
    }
    /**
     * Sanitize error message for production use.
     *
     * @param error - Error object
     * @param status - HTTP status code
     * @returns Sanitized error message
     */
    _sanitizeErrorMessage(error, status) {
        // In production, return generic messages to avoid information disclosure
        if (process.env.NODE_ENV === 'production') {
            const genericMessages = {
                400: 'Invalid request parameters',
                401: 'Authentication failed',
                403: 'Access forbidden',
                404: 'Resource not found',
                429: 'Rate limit exceeded',
                500: 'Service error',
                502: 'Service temporarily unavailable',
                503: 'Service temporarily unavailable',
            };
            return genericMessages[status] || 'An error occurred';
        }
        // In development, return detailed error messages
        const axiosError = error;
        return axiosError.response?.data?.error?.message || axiosError.message || 'Unknown error';
    }
    /**
     * Translate an axios failure into the package's error vocabulary.
     *
     * @param error - Whatever axios rejected with
     * @throws Error Always
     */
    _throwApiError(error) {
        this.logger.error(`API request failed: ${error.message}`);
        const axiosError = error;
        if (axiosError.response) {
            const status = axiosError.response.status;
            const sanitizedMessage = this._sanitizeErrorMessage(error, status);
            if (status === 401) {
                throw new Error('Authentication failed. Please check your API key.');
            }
            else if (status === 400) {
                throw new Error(`Bad request: ${sanitizedMessage}`);
            }
            else if (status === 429) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }
            else if (status === 500 || status === 502 || status === 503) {
                throw new Error('OpenAI service error. Please try again later.');
            }
            else {
                throw new Error(`API error (${status}): ${sanitizedMessage}`);
            }
        }
        throw new Error(`Request failed: ${error.message}`);
    }
    /**
     * Enforce the minimum delay between requests, then stamp this one.
     */
    async _rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (this.lastRequestTime > 0 && timeSinceLastRequest < this.rateLimitDelay) {
            const delay = this.rateLimitDelay - timeSinceLastRequest;
            this.logger.debug(`Rate limit: waiting ${delay}ms before next request`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        this.lastRequestTime = Date.now();
    }
    /**
     * Build request headers, merging multipart boundary headers when present.
     */
    _headers(data, isMultipart) {
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
        };
        if (isMultipart) {
            // form-data supplies the Content-Type with its boundary
            Object.assign(headers, data.getHeaders?.() ?? {});
        }
        else {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    }
    /**
     * Make a buffered HTTP request to the OpenAI API.
     *
     * @param method - HTTP method (GET, POST)
     * @param endpoint - API endpoint path
     * @param data - Request payload
     * @param isMultipart - Whether this is a multipart/form-data request
     * @returns JSON response from API
     */
    async _makeRequest(method, endpoint, data = null, isMultipart = false) {
        await this._rateLimit();
        const url = `${this.baseUrl}${endpoint}`;
        const headers = this._headers(data, isMultipart);
        this.logger.debug(`API request: ${method} ${endpoint}`, {
            headers: { ...headers, Authorization: `Bearer ${this._redactApiKey(this.apiKey)}` },
        });
        try {
            let response;
            if (method.toUpperCase() === 'GET') {
                response = await axios.get(url, { headers, timeout: this.requestTimeout });
            }
            else if (method.toUpperCase() === 'POST') {
                response = await axios.post(url, data, { headers, timeout: this.requestTimeout });
            }
            else {
                throw new Error(`Unsupported HTTP method: ${method}`);
            }
            this.logger.debug(`API request successful: ${method} ${endpoint}`);
            return response.data;
        }
        catch (error) {
            this._throwApiError(error);
        }
    }
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
    async *_makeStreamRequest(endpoint, data, isMultipart) {
        await this._rateLimit();
        const url = `${this.baseUrl}${endpoint}`;
        const headers = { ...this._headers(data, isMultipart), Accept: 'text/event-stream' };
        this.logger.debug(`API stream request: POST ${endpoint}`, {
            headers: { ...headers, Authorization: `Bearer ${this._redactApiKey(this.apiKey)}` },
        });
        let stream;
        try {
            const response = await axios.post(url, data, {
                headers,
                timeout: this.requestTimeout,
                responseType: 'stream',
            });
            stream = response.data;
        }
        catch (error) {
            // Recover the JSON error body from the stream so the message is useful
            const axiosError = error;
            const body = axiosError.response?.data;
            if (body && typeof body.on === 'function') {
                try {
                    const text = await readStreamToString(body);
                    axiosError.response.data = JSON.parse(text);
                }
                catch {
                    axiosError.response.data = undefined;
                }
            }
            this._throwApiError(error);
        }
        for await (const raw of parseSSEStream(stream)) {
            if (!raw.data)
                continue;
            let event;
            try {
                event = JSON.parse(raw.data);
            }
            catch {
                this.logger.warn(`Skipping unparseable stream event (${raw.event ?? 'no event name'})`);
                continue;
            }
            // The API may surface an error as a terminal event rather than a status
            if (event.type === 'error') {
                const err = event;
                throw new Error(`Stream error: ${err.error?.message ?? 'unknown error'}`);
            }
            yield event;
        }
    }
    /**
     * Build the JSON payload for a generation request.
     */
    _buildGeneratePayload(params) {
        const { prompt, model = DEFAULT_MODEL, size, quality, n, background, output_format, output_compression, moderation, user, partial_images, stream, } = params;
        const payload = { prompt, model };
        if (n !== undefined)
            payload.n = n;
        if (size)
            payload.size = size;
        if (quality)
            payload.quality = quality;
        if (background)
            payload.background = background;
        if (output_format)
            payload.output_format = output_format;
        if (output_compression !== undefined)
            payload.output_compression = output_compression;
        if (moderation)
            payload.moderation = moderation;
        if (user)
            payload.user = user;
        if (stream)
            payload.stream = true;
        if (partial_images !== undefined)
            payload.partial_images = partial_images;
        return payload;
    }
    /**
     * Build the multipart form for an edit request.
     *
     * Images are appended under `image[]` for every GPT Image model — the
     * reference's own curl examples use that key with gpt-image-1.5.
     */
    _buildEditForm(params) {
        const { image, prompt, model = DEFAULT_MODEL, mask, size, n, quality, input_fidelity, background, output_format, output_compression, moderation, user, partial_images, stream, } = params;
        const formData = new FormData();
        const images = Array.isArray(image) ? image : [image];
        images.forEach((imgPath) => formData.append('image[]', createReadStream(imgPath)));
        formData.append('prompt', prompt);
        formData.append('model', model);
        if (n !== undefined)
            formData.append('n', n.toString());
        if (size)
            formData.append('size', size);
        if (quality)
            formData.append('quality', quality);
        if (mask)
            formData.append('mask', createReadStream(mask));
        if (input_fidelity)
            formData.append('input_fidelity', input_fidelity);
        if (background)
            formData.append('background', background);
        if (output_format)
            formData.append('output_format', output_format);
        if (output_compression !== undefined)
            formData.append('output_compression', output_compression.toString());
        if (moderation)
            formData.append('moderation', moderation);
        if (user)
            formData.append('user', user);
        if (stream)
            formData.append('stream', 'true');
        if (partial_images !== undefined)
            formData.append('partial_images', partial_images.toString());
        return formData;
    }
    /**
     * Shared pre-flight for generation requests.
     */
    _prepareGenerate(params) {
        this._verifyApiKey();
        const model = params.model ?? DEFAULT_MODEL;
        if (!params.prompt) {
            throw new Error('Prompt is required');
        }
        const validation = validateModelParams(model, params);
        if (!validation.valid) {
            throw new Error(`Parameter validation failed:\n  - ${validation.errors.join('\n  - ')}`);
        }
        this._warnIfDeprecated(model);
        return model;
    }
    /**
     * Shared pre-flight for edit requests.
     */
    _prepareEdit(params) {
        this._verifyApiKey();
        const model = params.model ?? DEFAULT_MODEL;
        if (!params.image || (Array.isArray(params.image) && params.image.length === 0)) {
            throw new Error('Image is required for edit operation');
        }
        if (!params.prompt) {
            throw new Error('Prompt is required');
        }
        const constraints = getModelConstraints(model);
        if (!constraints) {
            throw new Error(`Unknown model: ${model}`);
        }
        if (!constraints.supportsEdit) {
            throw new Error(`Model ${model} does not support image editing`);
        }
        const images = Array.isArray(params.image) ? params.image : [params.image];
        if (images.length > constraints.editMaxImages) {
            throw new Error(`${model} accepts at most ${constraints.editMaxImages} input images`);
        }
        const validation = validateModelParams(model, params);
        if (!validation.valid) {
            throw new Error(`Parameter validation failed:\n  - ${validation.errors.join('\n  - ')}`);
        }
        this._warnIfDeprecated(model);
        return model;
    }
    /**
     * Convert a terminal stream event into the buffered response shape, so
     * streaming and non-streaming callers can share `saveImages`.
     */
    _completedToResponse(event) {
        return {
            created: event.created_at,
            data: [{ b64_json: event.b64_json }],
            usage: event.usage,
            output_format: event.output_format,
            quality: event.quality,
            size: event.size,
            background: event.background,
        };
    }
    // ===========================================================================
    // Generation
    // ===========================================================================
    /**
     * Generate image from text prompt.
     *
     * @param params - Generation parameters
     * @returns Generation response with base64 image data
     */
    async generateImage(params) {
        const model = this._prepareGenerate(params);
        const payload = this._buildGeneratePayload({ ...params, model: model });
        this.logger.info(`Generating image with ${model}: "${params.prompt.substring(0, 50)}..."`);
        this.logger.debug(`Request payload: ${JSON.stringify(payload)}`);
        const response = await this._makeRequest('POST', ENDPOINTS.generate, payload, false);
        this.logger.info(`Image generation complete. Generated ${response.data.length} image(s)`);
        return response;
    }
    /**
     * Generate an image, streaming partial frames as they render.
     *
     * Yields `image_generation.partial_image` events (0 to `partial_images` of
     * them) followed by one `image_generation.completed` event carrying the
     * final image and usage.
     *
     * @param params - Generation parameters plus `partial_images`
     */
    async *streamImage(params) {
        const model = this._prepareGenerate(params);
        const payload = this._buildGeneratePayload({
            ...params,
            model: model,
            stream: true,
        });
        this.logger.info(`Streaming image with ${model}: "${params.prompt.substring(0, 50)}..."`);
        this.logger.debug(`Request payload: ${JSON.stringify(payload)}`);
        yield* this._makeStreamRequest(ENDPOINTS.generate, payload, false);
    }
    /**
     * Generate an image with streaming, invoking a callback per partial frame
     * and resolving to the final image in the buffered response shape.
     *
     * @param params - Generation parameters plus `partial_images`
     * @param handlers - Optional `onPartialImage` callback
     * @returns The completed image as an ImageResponse
     * @throws Error If the stream ends without a completed event
     */
    async generateImageStream(params, handlers = {}) {
        for await (const event of this.streamImage(params)) {
            if (event.type === 'image_generation.partial_image') {
                this.logger.debug(`Partial image ${event.partial_image_index} received`);
                await handlers.onPartialImage?.(event);
            }
            else if (event.type === 'image_generation.completed') {
                this.logger.info('Image generation stream complete');
                return this._completedToResponse(event);
            }
        }
        throw new Error('Stream ended without an image_generation.completed event');
    }
    // ===========================================================================
    // Editing
    // ===========================================================================
    /**
     * Edit image(s) with prompt.
     *
     * @param params - Edit parameters
     * @returns Edit response with base64 image data
     */
    async generateImageEdit(params) {
        const model = this._prepareEdit(params);
        const formData = this._buildEditForm({ ...params, model: model });
        this.logger.info(`Editing image(s) with ${model}: "${params.prompt.substring(0, 50)}..."`);
        const response = await this._makeRequest('POST', ENDPOINTS.edit, formData, true);
        this.logger.info(`Image edit complete. Generated ${response.data.length} image(s)`);
        return response;
    }
    /**
     * Edit image(s), streaming partial frames as they render.
     *
     * Yields `image_edit.partial_image` events followed by one
     * `image_edit.completed` event.
     *
     * @param params - Edit parameters plus `partial_images`
     */
    async *streamImageEdit(params) {
        const model = this._prepareEdit(params);
        const formData = this._buildEditForm({
            ...params,
            model: model,
            stream: true,
        });
        this.logger.info(`Streaming edit with ${model}: "${params.prompt.substring(0, 50)}..."`);
        yield* this._makeStreamRequest(ENDPOINTS.edit, formData, true);
    }
    /**
     * Edit image(s) with streaming, invoking a callback per partial frame and
     * resolving to the final image in the buffered response shape.
     *
     * @param params - Edit parameters plus `partial_images`
     * @param handlers - Optional `onPartialImage` callback
     * @returns The completed image as an ImageResponse
     * @throws Error If the stream ends without a completed event
     */
    async generateImageEditStream(params, handlers = {}) {
        for await (const event of this.streamImageEdit(params)) {
            if (event.type === 'image_edit.partial_image') {
                this.logger.debug(`Partial image ${event.partial_image_index} received`);
                await handlers.onPartialImage?.(event);
            }
            else if (event.type === 'image_edit.completed') {
                this.logger.info('Image edit stream complete');
                return this._completedToResponse(event);
            }
        }
        throw new Error('Stream ended without an image_edit.completed event');
    }
    // ===========================================================================
    // Persistence
    // ===========================================================================
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
    async saveImages(response, outputDir, baseFilename, format) {
        const ext = format ?? response.output_format ?? 'png';
        const savedPaths = [];
        for (let i = 0; i < response.data.length; i++) {
            const imageData = response.data[i];
            const filename = response.data.length > 1 ? `${baseFilename}_${i + 1}.${ext}` : `${baseFilename}.${ext}`;
            const filepath = `${outputDir}/${filename}`;
            if (!imageData.b64_json) {
                this.logger.warn(`No image data found for index ${i}`);
                continue;
            }
            await decodeBase64Image(imageData.b64_json, filepath);
            savedPaths.push(filepath);
        }
        return savedPaths;
    }
}
//# sourceMappingURL=api.js.map