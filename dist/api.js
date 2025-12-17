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
import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import winston from 'winston';
import { getOpenAIApiKey, BASE_URL, ENDPOINTS, validateModelParams, getModelConstraints, } from './config.js';
import { downloadImage, decodeBase64Image } from './utils.js';
/**
 * Wrapper class for OpenAI Image Generation API.
 *
 * Provides methods to generate, edit, and create variations of images
 * using DALL-E and GPT Image models.
 */
export class OpenAIImageAPI {
    logger;
    apiKey;
    baseUrl;
    rateLimitDelay;
    lastRequestTime;
    /**
     * Initialize OpenAIImageAPI instance.
     *
     * @param options - Configuration options
     * @param options.apiKey - OpenAI API key. If null, reads from environment.
     * @param options.baseUrl - API base URL (default: https://api.openai.com)
     * @param options.logLevel - Logging level (DEBUG, INFO, WARNING, ERROR)
     * @param options.rateLimitDelay - Minimum milliseconds between API requests (default: 1000)
     */
    constructor({ apiKey = null, baseUrl = BASE_URL, logLevel = 'INFO', rateLimitDelay = 1000, } = {}) {
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
        // Rate limiting
        this.rateLimitDelay = rateLimitDelay;
        this.lastRequestTime = 0;
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
     * Make HTTP request to OpenAI API.
     *
     * @param method - HTTP method (GET, POST)
     * @param endpoint - API endpoint path
     * @param data - Request payload
     * @param isMultipart - Whether this is a multipart/form-data request
     * @returns JSON response from API
     */
    async _makeRequest(method, endpoint, data = null, isMultipart = false) {
        // Rate limiting: ensure minimum delay between requests
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (this.lastRequestTime > 0 && timeSinceLastRequest < this.rateLimitDelay) {
            const delay = this.rateLimitDelay - timeSinceLastRequest;
            this.logger.debug(`Rate limit: waiting ${delay}ms before next request`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        this.lastRequestTime = Date.now();
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
        };
        if (!isMultipart) {
            headers['Content-Type'] = 'application/json';
        }
        // Sanitized headers for logging (redact API key)
        const sanitizedHeaders = {
            ...headers,
            Authorization: `Bearer ${this._redactApiKey(this.apiKey)}`,
        };
        this.logger.debug(`API request: ${method} ${endpoint}`, { headers: sanitizedHeaders });
        try {
            let response;
            const requestTimeout = 30000; // 30 second timeout for API calls
            if (method.toUpperCase() === 'GET') {
                response = await axios.get(url, { headers, timeout: requestTimeout });
            }
            else if (method.toUpperCase() === 'POST') {
                if (isMultipart) {
                    const formData = data;
                    // For FormData, axios will set the correct Content-Type with boundary
                    response = await axios.post(url, formData, {
                        headers: {
                            ...headers,
                            ...formData.getHeaders?.(),
                        },
                        timeout: requestTimeout,
                    });
                }
                else {
                    response = await axios.post(url, data, { headers, timeout: requestTimeout });
                }
            }
            else {
                throw new Error(`Unsupported HTTP method: ${method}`);
            }
            this.logger.debug(`API request successful: ${method} ${endpoint}`);
            return response.data;
        }
        catch (error) {
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
    }
    /**
     * Generate image from text prompt.
     *
     * @param params - Generation parameters
     * @returns Generation response with image data
     */
    async generateImage(params) {
        this._verifyApiKey();
        const { prompt, model = 'dall-e-2', size, quality, n = 1, style, background, output_format, output_compression, moderation, response_format, user, } = params;
        if (!prompt) {
            throw new Error('Prompt is required');
        }
        // Validate parameters
        const validation = validateModelParams(model, params);
        if (!validation.valid) {
            throw new Error(`Parameter validation failed:\n  - ${validation.errors.join('\n  - ')}`);
        }
        // Build request payload
        const payload = {
            prompt,
            model,
            n,
        };
        // Add model-specific parameters
        if (size)
            payload.size = size;
        if (quality)
            payload.quality = quality;
        // DALL-E 3 specific
        if (style && model === 'dall-e-3') {
            payload.style = style;
        }
        // GPT Image 1 specific
        if (model === 'gpt-image-1') {
            if (background)
                payload.background = background;
            if (output_format)
                payload.output_format = output_format;
            if (output_compression !== undefined)
                payload.output_compression = output_compression;
            if (moderation)
                payload.moderation = moderation;
        }
        else {
            // DALL-E models support response_format
            if (response_format)
                payload.response_format = response_format;
        }
        if (user)
            payload.user = user;
        this.logger.info(`Generating image with ${model}: "${prompt.substring(0, 50)}..."`);
        this.logger.debug(`Request payload: ${JSON.stringify(payload)}`);
        const response = await this._makeRequest('POST', ENDPOINTS.generate, payload, false);
        this.logger.info(`Image generation complete. Generated ${response.data.length} image(s)`);
        return response;
    }
    /**
     * Edit image with prompt.
     *
     * @param params - Edit parameters
     * @returns Edit response with image data
     */
    async generateImageEdit(params) {
        this._verifyApiKey();
        const { image, prompt, model = 'dall-e-2', mask, size, n = 1, quality, input_fidelity, background, output_format, output_compression, response_format, user, } = params;
        if (!image) {
            throw new Error('Image is required for edit operation');
        }
        if (!prompt) {
            throw new Error('Prompt is required');
        }
        // Check if model supports edit
        const constraints = getModelConstraints(model);
        if (!constraints || !constraints.supportsEdit) {
            throw new Error(`Model ${model} does not support image editing`);
        }
        // Validate parameters
        const validation = validateModelParams(model, params);
        if (!validation.valid) {
            throw new Error(`Parameter validation failed:\n  - ${validation.errors.join('\n  - ')}`);
        }
        // Build FormData for multipart request
        const formData = new FormData();
        // Add images (can be array for gpt-image-1, single for dall-e-2)
        const images = Array.isArray(image) ? image : [image];
        if (model === 'dall-e-2' && images.length > 1) {
            throw new Error('dall-e-2 only supports editing a single image');
        }
        images.forEach((imgPath) => {
            const key = model === 'gpt-image-1' ? 'image[]' : 'image';
            formData.append(key, createReadStream(imgPath));
        });
        formData.append('prompt', prompt);
        formData.append('model', model);
        formData.append('n', n.toString());
        if (size)
            formData.append('size', size);
        if (quality)
            formData.append('quality', quality);
        if (mask)
            formData.append('mask', createReadStream(mask));
        // Model-specific parameters
        if (model === 'gpt-image-1') {
            if (input_fidelity)
                formData.append('input_fidelity', input_fidelity);
            if (background)
                formData.append('background', background);
            if (output_format)
                formData.append('output_format', output_format);
            if (output_compression !== undefined) {
                formData.append('output_compression', output_compression.toString());
            }
        }
        else if (model === 'dall-e-2') {
            if (response_format)
                formData.append('response_format', response_format);
        }
        if (user)
            formData.append('user', user);
        this.logger.info(`Editing image(s) with ${model}: "${prompt.substring(0, 50)}..."`);
        const response = await this._makeRequest('POST', ENDPOINTS.edit, formData, true);
        this.logger.info(`Image edit complete. Generated ${response.data.length} image(s)`);
        return response;
    }
    /**
     * Create variations of an image.
     *
     * @param params - Variation parameters
     * @returns Variation response with image data
     */
    async generateImageVariation(params) {
        this._verifyApiKey();
        const { image, model = 'dall-e-2', n = 1, size, response_format, user } = params;
        if (!image) {
            throw new Error('Image is required for variation operation');
        }
        // Only dall-e-2 supports variations
        if (model !== 'dall-e-2') {
            throw new Error('Only dall-e-2 supports image variations');
        }
        // Check if model supports variation
        const constraints = getModelConstraints(model);
        if (!constraints || !constraints.supportsVariation) {
            throw new Error(`Model ${model} does not support image variations`);
        }
        // Build FormData for multipart request
        const formData = new FormData();
        formData.append('image', createReadStream(image));
        formData.append('model', model);
        formData.append('n', n.toString());
        if (size)
            formData.append('size', size);
        if (response_format)
            formData.append('response_format', response_format);
        if (user)
            formData.append('user', user);
        this.logger.info(`Creating ${n} variation(s) with ${model}`);
        const response = await this._makeRequest('POST', ENDPOINTS.variation, formData, true);
        this.logger.info(`Image variation complete. Generated ${response.data.length} image(s)`);
        return response;
    }
    /**
     * Download and save images from API response.
     *
     * @param response - API response object
     * @param outputDir - Directory to save images
     * @param baseFilename - Base filename (without extension)
     * @param format - Image format (png, jpg, webp)
     * @returns Array of saved file paths
     */
    async saveImages(response, outputDir, baseFilename, format = 'png') {
        const savedPaths = [];
        for (let i = 0; i < response.data.length; i++) {
            const imageData = response.data[i];
            const filename = response.data.length > 1 ? `${baseFilename}_${i + 1}.${format}` : `${baseFilename}.${format}`;
            const filepath = `${outputDir}/${filename}`;
            if (imageData.url) {
                // Download from URL (DALL-E 2/3)
                await downloadImage(imageData.url, filepath);
            }
            else if (imageData.b64_json) {
                // Decode base64 (GPT Image 1 or b64_json response)
                await decodeBase64Image(imageData.b64_json, filepath);
            }
            else {
                this.logger.warn(`No image data found for index ${i}`);
                continue;
            }
            savedPaths.push(filepath);
        }
        return savedPaths;
    }
}
// Export video API class for clean separation
export { OpenAIVideoAPI } from './video-api.js';
//# sourceMappingURL=api.js.map