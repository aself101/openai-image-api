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
import type { APIOptions, CreateVideoParams, ListVideosParams, VideoVariant, VideoObject, ListVideosResponse, PollVideoOptions } from './types.js';
/**
 * Wrapper class for OpenAI Video Generation API (Sora).
 *
 * Provides methods to create, retrieve, download, list, delete, and remix videos
 * using Sora 2 and Sora 2 Pro models.
 */
export declare class OpenAIVideoAPI {
    private logger;
    private apiKey;
    private baseUrl;
    private rateLimitDelay;
    private lastRequestTime;
    /**
     * Initialize OpenAIVideoAPI instance.
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
     * Build FormData payload for video creation with reference image.
     *
     * @param params - Video parameters
     * @returns Populated FormData object
     */
    private _buildVideoFormData;
    /**
     * Make HTTP request to OpenAI API.
     *
     * @param method - HTTP method (GET, POST, DELETE)
     * @param endpoint - API endpoint path (may contain {video_id} placeholder)
     * @param videoId - Optional video ID to replace in endpoint
     * @param data - Request payload
     * @param isMultipart - Whether this is a multipart/form-data request
     * @param options - Additional request options
     * @returns JSON response or binary data from API
     */
    private _makeRequest;
    /**
     * Create a new video generation job.
     *
     * @param params - Video generation parameters
     * @returns Video job object with id and initial status
     */
    createVideo(params: CreateVideoParams): Promise<VideoObject>;
    /**
     * Retrieve video job status and metadata.
     *
     * @param videoId - Video job ID
     * @param options - Request options
     * @returns Video object with current status and progress
     */
    retrieveVideo(videoId: string, options?: {
        signal?: AbortSignal;
    }): Promise<VideoObject>;
    /**
     * Download video content (MP4, thumbnail, or spritesheet).
     *
     * @param videoId - Video job ID
     * @param variant - Content variant (video, thumbnail, spritesheet, default: video)
     * @returns Binary video/image data
     */
    downloadVideoContent(videoId: string, variant?: VideoVariant): Promise<Buffer>;
    /**
     * List video jobs with pagination.
     *
     * @param params - List parameters
     * @returns Paginated list of video objects
     */
    listVideos(params?: ListVideosParams): Promise<ListVideosResponse>;
    /**
     * Delete a video job from storage.
     *
     * @param videoId - Video job ID to delete
     * @returns Deletion confirmation
     */
    deleteVideo(videoId: string): Promise<VideoObject>;
    /**
     * Remix an existing video with a new prompt.
     *
     * @param videoId - ID of completed video to remix
     * @param prompt - New prompt describing the changes
     * @returns New video job object
     */
    remixVideo(videoId: string, prompt: string): Promise<VideoObject>;
    /**
     * Wait for video generation to complete with polling.
     *
     * @param videoId - Video job ID
     * @param options - Polling options
     * @returns Completed video object
     * @throws Error If video generation fails, times out, or is cancelled
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
    waitForVideo(videoId: string, options?: PollVideoOptions): Promise<VideoObject>;
    /**
     * Create video and wait for completion (convenience method).
     *
     * @param params - Video generation parameters (same as createVideo)
     * @param pollOptions - Polling options (same as waitForVideo)
     * @returns Completed video object
     */
    createAndPoll(params: CreateVideoParams, pollOptions?: PollVideoOptions): Promise<VideoObject>;
}
//# sourceMappingURL=video-api.d.ts.map