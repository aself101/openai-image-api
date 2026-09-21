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
import path from 'path';
import { Readable } from 'stream';
import winston from 'winston';
import { getOpenAIApiKey, BASE_URL, ENDPOINTS, DEFAULT_MODEL, validateModelParams, getModelConstraints, getModelDeprecation, deprecationNotice, } from './config.js';
import { decodeBase64Image, parseSSEStream, readStreamToString, validateImagePath, validateOutputPath, assertSafeBaseFilename, multipartFilename, getErrorMessage, } from './utils.js';
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
export class OpenAIImageAPIError extends Error {
    /** HTTP status, when the API answered at all */
    status;
    /** `error.code` from the API body, when present */
    code;
    /**
     * `error.type` from the API body when the API answered; otherwise one of the
     * package's own: `validation_error` (rejected by the client-side constraint
     * check), `input_error` (an input file failed the pre-upload check),
     * `configuration_error` (no API key), `stream_error` (terminal error event
     * or early stream end). `status` is undefined for all four.
     */
    type;
    /**
     * `error.message` from the API body, when present — deliberately NOT subject
     * to the `NODE_ENV=production` sanitization applied to `message`. That
     * sanitization protects a server's end users from internal detail; the key
     * holder reading this field is the party the API's message is addressed to,
     * and OpenAI's error text names the rejected parameter or policy, not
     * internal paths. Do not forward it to end users unreviewed.
     */
    apiMessage;
    constructor(message, details = {}) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.name = 'OpenAIImageAPIError';
        this.status = details.status;
        this.code = details.code;
        this.type = details.type;
        this.apiMessage = details.apiMessage;
    }
}
/** Read the API error body off an axios rejection, if it carries one */
function apiErrorBody(error) {
    const data = error?.response?.data;
    if (typeof data !== 'object' || data === null)
        return undefined;
    const body = data.error;
    if (typeof body !== 'object' || body === null)
        return undefined;
    const { message, code, type } = body;
    return {
        message: typeof message === 'string' ? message : undefined,
        code: typeof code === 'string' ? code : undefined,
        type: typeof type === 'string' ? type : undefined,
    };
}
/** Narrow parsed SSE JSON to an object carrying a string `type` discriminator */
function isTypedEvent(value) {
    return typeof value === 'object' && value !== null && typeof value.type === 'string';
}
/**
 * Narrow a typed event to an image-bearing event: the one field every
 * partial/completed event must carry for the consumer to do anything with it.
 */
function isImageEvent(value) {
    return typeof value.b64_json === 'string';
}
/**
 * Read the message off a terminal `error` stream event. The Image API's
 * streaming error shape is not in the reference we hold; both the nested
 * `{ error: { message } }` and the flat `{ message }` (the Responses-API
 * streaming convention) forms are accepted. [VERIFY against a live error event]
 */
function streamErrorMessage(value) {
    const v = value;
    if (typeof v.error?.message === 'string')
        return v.error.message;
    if (typeof v.message === 'string')
        return v.message;
    return 'unknown error';
}
/** Default per-request timeout; see APIOptions.requestTimeout for rationale */
const DEFAULT_REQUEST_TIMEOUT = 180_000;
/**
 * Ceiling on a buffered (non-streaming) response body. Ten `max`-quality 4K
 * images as base64 fit well inside this; it exists so a hostile or broken
 * upstream cannot make axios buffer without limit.
 */
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
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
    skipValidation;
    lastRequestTime;
    /**
     * Serializes rate-limit waits. Without it, concurrent callers on one
     * instance all read the same lastRequestTime, sleep the same delay, and fire
     * together — the burst the limiter exists to prevent.
     */
    rateLimitQueue;
    /** Models already warned about, so a batch does not repeat the notice */
    deprecationWarned;
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
    constructor({ apiKey = null, baseUrl = BASE_URL, logLevel = 'WARNING', rateLimitDelay = 1000, requestTimeout = DEFAULT_REQUEST_TIMEOUT, skipValidation = false, } = {}) {
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
        this.skipValidation = skipValidation;
        this.lastRequestTime = 0;
        this.rateLimitQueue = Promise.resolve();
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
            throw new OpenAIImageAPIError('API key not set. Please provide apiKey during initialization ' +
                'or set OPENAI_API_KEY environment variable.', { type: 'configuration_error' });
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
        this.logger.warn(deprecationNotice(model, deprecation));
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
        return apiErrorBody(error)?.message || getErrorMessage(error) || 'Unknown error';
    }
    /**
     * Translate an axios failure into the package's error vocabulary.
     *
     * @param error - Whatever axios rejected with
     * @throws Error Always
     */
    _throwApiError(error) {
        // Errors already in our vocabulary (e.g. a terminal stream event) pass through
        if (error instanceof OpenAIImageAPIError)
            throw error;
        this.logger.error(`API request failed: ${getErrorMessage(error)}`);
        const response = error?.response;
        if (response) {
            const status = response.status;
            const body = apiErrorBody(error);
            // The raw API message is always logged at debug so a sanitized production
            // message can still be traced by the operator holding the logs.
            if (body?.message) {
                this.logger.debug(`API error body: status=${status} type=${body.type ?? '-'} code=${body.code ?? '-'} message=${body.message}`);
            }
            const sanitizedMessage = this._sanitizeErrorMessage(error, status);
            const details = { status, code: body?.code, type: body?.type, apiMessage: body?.message, cause: error };
            if (status === 401) {
                throw new OpenAIImageAPIError('Authentication failed. Please check your API key.', details);
            }
            else if (status === 400) {
                throw new OpenAIImageAPIError(`Bad request: ${sanitizedMessage}`, details);
            }
            else if (status === 429) {
                throw new OpenAIImageAPIError('Rate limit exceeded. Please try again later.', details);
            }
            else if (status === 500 || status === 502 || status === 503) {
                throw new OpenAIImageAPIError('OpenAI service error. Please try again later.', details);
            }
            else {
                throw new OpenAIImageAPIError(`API error (${status}): ${sanitizedMessage}`, details);
            }
        }
        throw new OpenAIImageAPIError(`Request failed: ${getErrorMessage(error)}`, { cause: error });
    }
    /**
     * Enforce the minimum delay between requests, then stamp this one.
     */
    _rateLimit() {
        const turn = this.rateLimitQueue.then(async () => {
            const timeSinceLastRequest = Date.now() - this.lastRequestTime;
            if (this.lastRequestTime > 0 && timeSinceLastRequest < this.rateLimitDelay) {
                const delay = this.rateLimitDelay - timeSinceLastRequest;
                this.logger.debug(`Rate limit: waiting ${delay}ms before next request`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            this.lastRequestTime = Date.now();
        });
        // The chain must never reject or every later caller would be stuck
        this.rateLimitQueue = turn.catch(() => undefined);
        return turn;
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
            const limits = { maxContentLength: MAX_RESPONSE_BYTES, maxBodyLength: MAX_RESPONSE_BYTES };
            if (method.toUpperCase() === 'GET') {
                response = await axios.get(url, { headers, timeout: this.requestTimeout, ...limits });
            }
            else if (method.toUpperCase() === 'POST') {
                response = await axios.post(url, data, { headers, timeout: this.requestTimeout, ...limits });
            }
            else {
                throw new Error(`Unsupported HTTP method: ${method}`);
            }
            this.logger.debug(`API request successful: ${method} ${endpoint}`);
            const body = response.data;
            if (typeof body !== 'object' || body === null || !Array.isArray(body.data)) {
                throw new OpenAIImageAPIError(`Unexpected response shape from ${endpoint}: expected an object with a data[] array`, { status: response.status });
            }
            return body;
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
            const response = error?.response;
            if (response && response.data instanceof Readable) {
                let text = '';
                try {
                    text = await readStreamToString(response.data);
                    response.data = JSON.parse(text);
                }
                catch (parseError) {
                    this.logger.debug(`Stream error body was not JSON (${getErrorMessage(parseError)}): ${text.slice(0, 500)}`);
                    response.data = undefined;
                }
            }
            this._throwApiError(error);
        }
        // Mid-body failures (idle timeout, connection reset) surface from the
        // iterator, not from axios.post, so they are routed through the same
        // translation as pre-headers failures.
        try {
            for await (const raw of parseSSEStream(stream)) {
                if (!raw.data)
                    continue;
                let parsed;
                try {
                    parsed = JSON.parse(raw.data);
                }
                catch {
                    this.logger.warn(`Skipping unparseable stream event (${raw.event ?? 'no event name'})`);
                    continue;
                }
                if (!isTypedEvent(parsed)) {
                    this.logger.warn(`Skipping stream event without a type field (${raw.event ?? 'no event name'})`);
                    continue;
                }
                // The API may surface an error as a terminal event rather than a status
                if (parsed.type === 'error') {
                    throw new OpenAIImageAPIError(`Stream error: ${streamErrorMessage(parsed)}`, { type: 'stream_error' });
                }
                if (!isImageEvent(parsed)) {
                    this.logger.warn(`Skipping ${parsed.type} event without b64_json`);
                    continue;
                }
                // SAFETY: narrowed on `type` and `b64_json`, the two fields consumers
                // branch on; the remaining documented fields are trusted, the same
                // trust the non-streaming path places in axios's parsed JSON body.
                yield parsed;
            }
        }
        catch (error) {
            this._throwApiError(error);
        }
        finally {
            // Whether the loop completed, threw, or the consumer broke out early,
            // release the socket rather than leaving the response half-read.
            if (!stream.destroyed)
                stream.destroy();
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
        // partial_images is meaningful only on a streaming request; a buffered
        // call that carries it (JS caller, spread object) would be a likely 400
        if (stream) {
            payload.stream = true;
            if (partial_images !== undefined)
                payload.partial_images = partial_images;
        }
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
        // An explicit filename keeps form-data from deriving one from the path,
        // which is where a CRLF in a hostile path would otherwise land.
        images.forEach((imgPath) => formData.append('image[]', createReadStream(imgPath), { filename: multipartFilename(imgPath) }));
        formData.append('prompt', prompt);
        formData.append('model', model);
        if (n !== undefined)
            formData.append('n', n.toString());
        if (size)
            formData.append('size', size);
        if (quality)
            formData.append('quality', quality);
        if (mask)
            formData.append('mask', createReadStream(mask), { filename: multipartFilename(mask) });
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
        if (stream) {
            formData.append('stream', 'true');
            if (partial_images !== undefined)
                formData.append('partial_images', partial_images.toString());
        }
        return formData;
    }
    /** Throw a client-side rejection in the package's error vocabulary */
    _reject(message, type, cause) {
        throw new OpenAIImageAPIError(message, { type, cause });
    }
    /**
     * Run the constraint check unless the caller opted out. In skip mode the
     * request is sent as-is and the API's own answer is what the caller gets.
     */
    _validate(model, params, streaming) {
        if (streaming && params.n !== undefined && params.n !== 1) {
            // This package's streaming wrappers return on the first completed event;
            // a multi-image stream would bill images this code never surfaces.
            this._reject('Streaming requests generate a single image; omit n or set it to 1', 'validation_error');
        }
        if (this.skipValidation) {
            if (!getModelConstraints(model)) {
                this.logger.warn(`Model ${model} is not in this package's catalogue; sending unvalidated (skipValidation)`);
            }
            return;
        }
        const validation = validateModelParams(model, params);
        if (!validation.valid) {
            const hint = validation.errors.length === 1 && validation.errors[0]?.startsWith('Unknown model')
                ? '\n  (pass skipValidation: true to send it to the API anyway)'
                : '';
            this._reject(`Parameter validation failed:\n  - ${validation.errors.join('\n  - ')}${hint}`, 'validation_error');
        }
    }
    /**
     * Shared pre-flight for generation requests.
     */
    _prepareGenerate(params, streaming = false) {
        this._verifyApiKey();
        const model = params.model ?? DEFAULT_MODEL;
        if (!params.prompt) {
            this._reject('Prompt is required', 'validation_error');
        }
        this._validate(model, params, streaming);
        this._warnIfDeprecated(model);
        return model;
    }
    /**
     * Shared pre-flight for edit requests.
     */
    async _prepareEdit(params, streaming = false) {
        this._verifyApiKey();
        const model = params.model ?? DEFAULT_MODEL;
        if (!params.image || (Array.isArray(params.image) && params.image.length === 0)) {
            this._reject('Image is required for edit operation', 'validation_error');
        }
        if (!params.prompt) {
            this._reject('Prompt is required', 'validation_error');
        }
        const constraints = getModelConstraints(model);
        const images = Array.isArray(params.image) ? params.image : [params.image];
        if (constraints) {
            if (!constraints.supportsEdit) {
                this._reject(`Model ${model} does not support image editing`, 'validation_error');
            }
            if (images.length > constraints.editMaxImages && !this.skipValidation) {
                this._reject(`${model} accepts at most ${constraints.editMaxImages} input images`, 'validation_error');
            }
        }
        this._validate(model, params, streaming);
        // Fail fast on inputs the API would reject: missing files, oversize files
        // and non-image bytes, checked by header before any upload begins.
        const maxSize = constraints?.imageMaxSize;
        for (const file of params.mask ? [...images, params.mask] : images) {
            try {
                await validateImagePath(file, maxSize);
            }
            catch (error) {
                this._reject(getErrorMessage(error), 'input_error', error);
            }
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
        const payload = this._buildGeneratePayload({ ...params, model });
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
        const model = this._prepareGenerate(params, true);
        const payload = this._buildGeneratePayload({ ...params, model, stream: true });
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
        throw new OpenAIImageAPIError('Stream ended without an image_generation.completed event', { type: 'stream_error' });
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
        const model = await this._prepareEdit(params);
        const formData = this._buildEditForm({ ...params, model });
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
        const model = await this._prepareEdit(params, true);
        const formData = this._buildEditForm({ ...params, model, stream: true });
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
        throw new OpenAIImageAPIError('Stream ended without an image_edit.completed event', { type: 'stream_error' });
    }
    // ===========================================================================
    // Persistence
    // ===========================================================================
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
     */
    async saveImages(response, outputDir, baseFilename, format) {
        const safeDir = validateOutputPath(outputDir);
        assertSafeBaseFilename(baseFilename);
        const ext = (format ?? response.output_format ?? 'png').replace(/[^a-z0-9]/gi, '') || 'png';
        const savedPaths = [];
        for (const [i, imageData] of response.data.entries()) {
            const filename = response.data.length > 1 ? `${baseFilename}_${i + 1}.${ext}` : `${baseFilename}.${ext}`;
            const filepath = path.join(safeDir, filename);
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