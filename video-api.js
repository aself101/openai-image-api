/**
 * OpenAI Video Generation API Wrapper (Sora)
 *
 * Main API wrapper class for interacting with OpenAI's Video Generation API.
 * Supports Sora 2 and Sora 2 Pro models for text-to-video and video remixing.
 *
 * All video generation methods follow an asynchronous pattern:
 * 1. Verify API key is set
 * 2. Validate parameters
 * 3. Build request payload
 * 4. Submit generation request (returns job object)
 * 5. Poll for completion (optional, via waitForVideo or createAndPoll)
 * 6. Download video content when ready
 *
 * @example
 * const api = new OpenAIVideoAPI();
 * const video = await api.createAndPoll({
 *   prompt: 'a cat on a motorcycle',
 *   model: 'sora-2',
 *   seconds: 8
 * });
 * const buffer = await api.downloadVideoContent(video.id);
 */

import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import winston from 'winston';
import {
  getOpenAIApiKey,
  BASE_URL,
  VIDEO_ENDPOINTS,
  validateVideoParams,
  getVideoModelConstraints
} from './config.js';
import {
  pollVideoWithProgress,
  validateImagePath
} from './utils.js';

/**
 * Wrapper class for OpenAI Video Generation API (Sora).
 *
 * Provides methods to create, retrieve, download, list, delete, and remix videos
 * using Sora 2 and Sora 2 Pro models.
 */
export class OpenAIVideoAPI {
  /**
   * Initialize OpenAIVideoAPI instance.
   *
   * @param {Object} options - Configuration options
   * @param {string} options.apiKey - OpenAI API key. If null, reads from environment.
   * @param {string} options.baseUrl - API base URL (default: https://api.openai.com)
   * @param {string} options.logLevel - Logging level (DEBUG, INFO, WARNING, ERROR)
   * @param {number} options.rateLimitDelay - Minimum milliseconds between API requests (default: 1000)
   */
  constructor({ apiKey = null, baseUrl = BASE_URL, logLevel = 'INFO', rateLimitDelay = 1000 } = {}) {
    // Setup logging
    this.logger = winston.createLogger({
      level: logLevel.toLowerCase(),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} - ${level.toUpperCase()} - ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console()
      ]
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

    this.logger.info('OpenAIVideoAPI initialized successfully');
  }

  /**
   * Verify that API key is set.
   *
   * @throws {Error} If API key is not set
   */
  _verifyApiKey() {
    if (!this.apiKey) {
      throw new Error(
        'API key not set. Please provide apiKey during initialization ' +
        'or set OPENAI_API_KEY environment variable.'
      );
    }
  }

  /**
   * Redact API key for logging purposes.
   *
   * @param {string} apiKey - API key to redact
   * @returns {string} Redacted API key showing only last 4 characters
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
   * @param {Error} error - Error object
   * @param {number} status - HTTP status code
   * @returns {string} Sanitized error message
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
        503: 'Service temporarily unavailable'
      };

      return genericMessages[status] || 'An error occurred';
    }

    // In development, return detailed error messages
    return error.response?.data?.error?.message || error.message;
  }

  /**
   * Build FormData payload for video creation with reference image.
   *
   * @param {Object} params - Video parameters
   * @param {string} params.prompt - Text prompt
   * @param {string} params.model - Model name
   * @param {string} params.size - Video size
   * @param {number} params.seconds - Duration in seconds
   * @param {string} params.input_reference - Path to reference image
   * @returns {FormData} Populated FormData object
   */
  _buildVideoFormData(params) {
    const { prompt, model, size, seconds, input_reference } = params;
    const formData = new FormData();

    formData.append('prompt', prompt);
    formData.append('model', model);

    if (size) formData.append('size', size);
    if (seconds) formData.append('seconds', seconds.toString());
    formData.append('input_reference', createReadStream(input_reference));

    return formData;
  }

  /**
   * Make HTTP request to OpenAI API.
   *
   * @param {string} method - HTTP method (GET, POST, DELETE)
   * @param {string} endpoint - API endpoint path (may contain {video_id} placeholder)
   * @param {string} videoId - Optional video ID to replace in endpoint
   * @param {Object|FormData} data - Request payload
   * @param {boolean} isMultipart - Whether this is a multipart/form-data request
   * @param {Object} options - Additional request options
   * @param {AbortSignal} options.signal - Optional AbortSignal for request cancellation
   * @returns {Promise<Object|Buffer>} JSON response or binary data from API
   */
  async _makeRequest(method, endpoint, videoId = null, data = null, isMultipart = false, options = {}) {
    // Rate limiting: ensure minimum delay between requests
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (this.lastRequestTime > 0 && timeSinceLastRequest < this.rateLimitDelay) {
      const delay = this.rateLimitDelay - timeSinceLastRequest;
      this.logger.debug(`Rate limit: waiting ${delay}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();

    // Replace {video_id} placeholder in endpoint if provided
    let finalEndpoint = endpoint;
    if (videoId) {
      finalEndpoint = endpoint.replace('{video_id}', videoId);
    }

    const url = `${this.baseUrl}${finalEndpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`
    };

    if (!isMultipart) {
      headers['Content-Type'] = 'application/json';
    }

    // Sanitized headers for logging (redact API key)
    const sanitizedHeaders = {
      ...headers,
      'Authorization': `Bearer ${this._redactApiKey(this.apiKey)}`
    };

    this.logger.debug(`API request: ${method} ${finalEndpoint}`, { headers: sanitizedHeaders });

    try {
      let response;
      const requestConfig = {
        headers,
        timeout: options.timeout || 30000, // 30s default
        signal: options.signal, // Support AbortController cancellation
        ...options
      };

      if (method.toUpperCase() === 'GET') {
        response = await axios.get(url, requestConfig);
      } else if (method.toUpperCase() === 'POST') {
        if (isMultipart) {
          // For FormData, axios will set the correct Content-Type with boundary
          response = await axios.post(url, data, {
            ...requestConfig,
            headers: {
              ...headers,
              ...data.getHeaders?.() // Get headers from FormData if available
            }
          });
        } else {
          response = await axios.post(url, data, requestConfig);
        }
      } else if (method.toUpperCase() === 'DELETE') {
        response = await axios.delete(url, requestConfig);
      }

      this.logger.debug(`API request successful: ${method} ${finalEndpoint}`);

      // Return binary data for content endpoint, otherwise return JSON
      if (options.responseType === 'arraybuffer') {
        return Buffer.from(response.data);
      }

      return response.data;

    } catch (error) {
      // Handle request cancellation
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        this.logger.info('API request was cancelled');
        throw new Error('Request was cancelled');
      }

      this.logger.error(`API request failed: ${error.message}`);

      if (error.response) {
        const status = error.response.status;
        const sanitizedMessage = this._sanitizeErrorMessage(error, status);

        if (status === 401) {
          throw new Error('Authentication failed. Please check your API key.');
        } else if (status === 400) {
          throw new Error(`Bad request: ${sanitizedMessage}`);
        } else if (status === 404) {
          throw new Error(`Resource not found: ${sanitizedMessage}`);
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else if (status === 500 || status === 502 || status === 503) {
          throw new Error('OpenAI service error. Please try again later.');
        } else {
          throw new Error(`API error (${status}): ${sanitizedMessage}`);
        }
      }

      throw new Error(`Request failed: ${error.message}`);
    }
  }

  /**
   * Create a new video generation job.
   *
   * @param {Object} params - Video generation parameters
   * @param {string} params.prompt - Text description of desired video (required)
   * @param {string} params.model - Model to use (sora-2 or sora-2-pro, default: sora-2)
   * @param {string} params.size - Video resolution (e.g., 1280x720, 1792x1024)
   * @param {number|string} params.seconds - Video duration in seconds (4, 8, or 12)
   * @param {string} params.input_reference - Path to reference image for first frame (optional)
   * @returns {Promise<Object>} Video job object with id and initial status
   */
  async createVideo(params) {
    this._verifyApiKey();

    const {
      prompt,
      model = 'sora-2',
      size,
      seconds,
      input_reference
    } = params;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    // Validate parameters
    const validation = validateVideoParams(model, params);
    if (!validation.valid) {
      throw new Error(`Parameter validation failed:\n  - ${validation.errors.join('\n  - ')}`);
    }

    // Determine if we need multipart (when input_reference is provided)
    const useMultipart = !!input_reference;

    let requestData;

    if (useMultipart) {
      // Validate input reference image
      await validateImagePath(input_reference);

      // Build FormData for multipart request
      requestData = this._buildVideoFormData({ prompt, model, size, seconds, input_reference });

      this.logger.info(`Creating video with ${model} and input reference: "${prompt.substring(0, 50)}..."`);
    } else {
      // Build JSON payload
      requestData = {
        prompt,
        model
      };

      if (size) requestData.size = size;
      if (seconds) requestData.seconds = seconds; // API expects string: "4", "8", or "12"

      this.logger.info(`Creating video with ${model}: "${prompt.substring(0, 50)}..."`);
    }

    this.logger.debug(`Request payload: ${useMultipart ? 'multipart/form-data' : JSON.stringify(requestData)}`);

    const response = await this._makeRequest('POST', VIDEO_ENDPOINTS.create, null, requestData, useMultipart);

    this.logger.info(`Video job created: ${response.id} (status: ${response.status})`);
    return response;
  }

  /**
   * Retrieve video job status and metadata.
   *
   * @param {string} videoId - Video job ID
   * @param {Object} options - Request options
   * @param {AbortSignal} options.signal - Optional AbortSignal for cancellation
   * @returns {Promise<Object>} Video object with current status and progress
   */
  async retrieveVideo(videoId, options = {}) {
    this._verifyApiKey();

    if (!videoId) {
      throw new Error('Video ID is required');
    }

    this.logger.debug(`Retrieving video status: ${videoId}`);

    const response = await this._makeRequest('GET', VIDEO_ENDPOINTS.retrieve, videoId, null, false, options);

    this.logger.debug(`Video ${videoId} status: ${response.status} (${response.progress || 0}% complete)`);
    return response;
  }

  /**
   * Download video content (MP4, thumbnail, or spritesheet).
   *
   * @param {string} videoId - Video job ID
   * @param {string} variant - Content variant (video, thumbnail, spritesheet, default: video)
   * @returns {Promise<Buffer>} Binary video/image data
   */
  async downloadVideoContent(videoId, variant = 'video') {
    this._verifyApiKey();

    if (!videoId) {
      throw new Error('Video ID is required');
    }

    // Validate variant
    const validation = validateVideoParams('sora-2', { variant });
    if (!validation.valid) {
      throw new Error(`Invalid variant: ${variant}. Valid options: video, thumbnail, spritesheet`);
    }

    this.logger.info(`Downloading ${variant} content for video: ${videoId}`);

    // Build URL with query parameter
    const endpoint = variant === 'video'
      ? VIDEO_ENDPOINTS.content
      : `${VIDEO_ENDPOINTS.content}?variant=${variant}`;

    const buffer = await this._makeRequest(
      'GET',
      endpoint,
      videoId,
      null,
      false,
      { responseType: 'arraybuffer', timeout: 60000 } // 60s timeout for downloads
    );

    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    this.logger.info(`Downloaded ${variant}: ${sizeMB}MB`);

    return buffer;
  }

  /**
   * List video jobs with pagination.
   *
   * @param {Object} params - List parameters
   * @param {number} params.limit - Number of items to retrieve (default: 20)
   * @param {string} params.after - Cursor for pagination (video ID)
   * @param {string} params.order - Sort order (asc or desc, default: desc)
   * @returns {Promise<Object>} Paginated list of video objects
   */
  async listVideos(params = {}) {
    this._verifyApiKey();

    const {
      limit = 20,
      after,
      order = 'desc'
    } = params;

    // Build query parameters
    const queryParams = new URLSearchParams();
    if (limit) queryParams.append('limit', limit.toString());
    if (after) queryParams.append('after', after);
    if (order) queryParams.append('order', order);

    const endpoint = `${VIDEO_ENDPOINTS.list}?${queryParams.toString()}`;

    this.logger.debug(`Listing videos: limit=${limit}, order=${order}`);

    const response = await this._makeRequest('GET', endpoint);

    this.logger.info(`Retrieved ${response.data?.length || 0} video(s)`);
    return response;
  }

  /**
   * Delete a video job from storage.
   *
   * @param {string} videoId - Video job ID to delete
   * @returns {Promise<Object>} Deletion confirmation
   */
  async deleteVideo(videoId) {
    this._verifyApiKey();

    if (!videoId) {
      throw new Error('Video ID is required');
    }

    this.logger.info(`Deleting video: ${videoId}`);

    const response = await this._makeRequest('DELETE', VIDEO_ENDPOINTS.delete, videoId);

    this.logger.info(`Video deleted: ${videoId}`);
    return response;
  }

  /**
   * Remix an existing video with a new prompt.
   *
   * @param {string} videoId - ID of completed video to remix
   * @param {string} prompt - New prompt describing the changes
   * @returns {Promise<Object>} New video job object
   */
  async remixVideo(videoId, prompt) {
    this._verifyApiKey();

    if (!videoId) {
      throw new Error('Video ID is required');
    }

    if (!prompt) {
      throw new Error('Prompt is required for remix');
    }

    // Validate prompt length
    const validation = validateVideoParams('sora-2', { prompt });
    if (!validation.valid) {
      throw new Error(`Parameter validation failed:\n  - ${validation.errors.join('\n  - ')}`);
    }

    this.logger.info(`Remixing video ${videoId}: "${prompt.substring(0, 50)}..."`);

    const requestData = { prompt };

    const response = await this._makeRequest('POST', VIDEO_ENDPOINTS.remix, videoId, requestData, false);

    this.logger.info(`Remix job created: ${response.id} (based on ${videoId})`);
    return response;
  }

  /**
   * Wait for video generation to complete with polling.
   *
   * @param {string} videoId - Video job ID
   * @param {Object} options - Polling options
   * @param {number} options.interval - Polling interval in milliseconds (default: 10000)
   * @param {number} options.timeout - Maximum wait time in milliseconds (default: 600000)
   * @param {boolean} options.showSpinner - Whether to show CLI spinner (default: true)
   * @param {AbortSignal} options.signal - Optional AbortSignal for cancellation
   * @returns {Promise<Object>} Completed video object
   * @throws {Error} If video generation fails, times out, or is cancelled
   * @example
   * // With cancellation support
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 30000); // Cancel after 30s
   * try {
   *   const video = await api.waitForVideo('video_123', { signal: controller.signal });
   * } catch (error) {
   *   if (error.message.includes('cancelled')) {
   *     console.log('Operation was cancelled');
   *   }
   * }
   */
  async waitForVideo(videoId, options = {}) {
    this._verifyApiKey();

    if (!videoId) {
      throw new Error('Video ID is required');
    }

    this.logger.info(`Waiting for video completion: ${videoId}`);

    const video = await pollVideoWithProgress(this, videoId, options);

    return video;
  }

  /**
   * Create video and wait for completion (convenience method).
   *
   * @param {Object} params - Video generation parameters (same as createVideo)
   * @param {Object} pollOptions - Polling options (same as waitForVideo)
   * @returns {Promise<Object>} Completed video object
   */
  async createAndPoll(params, pollOptions = {}) {
    const video = await this.createVideo(params);
    const completed = await this.waitForVideo(video.id, pollOptions);
    return completed;
  }
}
