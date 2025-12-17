/**
 * OpenAI Image & Video API Type Definitions
 *
 * Comprehensive type definitions for the OpenAI Image Generation API
 * (DALL-E, GPT Image) and Video Generation API (Sora).
 */

import type { Logger } from 'winston';

// =============================================================================
// Model Types
// =============================================================================

/** Image generation model identifiers */
export type ImageModel = 'dall-e-2' | 'dall-e-3' | 'gpt-image-1' | 'gpt-image-1.5';

/** Video generation model identifiers */
export type VideoModel = 'sora-2' | 'sora-2-pro';

/** Log level options */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

// =============================================================================
// API Constructor Options
// =============================================================================

/** Configuration options for API class initialization */
export interface APIOptions {
  /** OpenAI API key. If null/undefined, reads from environment */
  apiKey?: string | null;
  /** API base URL (default: https://api.openai.com) */
  baseUrl?: string;
  /** Logging level (default: INFO) */
  logLevel?: LogLevel;
  /** Minimum milliseconds between API requests (default: 1000) */
  rateLimitDelay?: number;
}

// =============================================================================
// Image Generation Types
// =============================================================================

/** Parameters for image generation */
export interface GenerateImageParams {
  /** Text description of desired image (required) */
  prompt: string;
  /** Model to use (default: dall-e-2) */
  model?: ImageModel;
  /** Image size (model-specific) */
  size?: string;
  /** Image quality (model-specific) */
  quality?: string;
  /** Number of images to generate (default: 1) */
  n?: number;
  /** Style for DALL-E 3: vivid or natural */
  style?: 'vivid' | 'natural';
  /** Background for GPT Image 1: auto, transparent, or opaque */
  background?: 'auto' | 'transparent' | 'opaque';
  /** Output format for GPT Image 1 */
  output_format?: 'png' | 'jpeg' | 'webp';
  /** Compression level 0-100 for GPT Image 1 */
  output_compression?: number;
  /** Moderation level for GPT Image 1 */
  moderation?: 'auto' | 'low';
  /** Response format for DALL-E models */
  response_format?: 'url' | 'b64_json';
  /** User identifier for monitoring */
  user?: string;
}

/** Parameters for image editing */
export interface EditImageParams {
  /** Image file path(s) for editing */
  image: string | string[];
  /** Text description of desired edit (required) */
  prompt: string;
  /** Model to use (default: dall-e-2) */
  model?: ImageModel;
  /** Mask image file path (optional) */
  mask?: string;
  /** Image size */
  size?: string;
  /** Number of images to generate (default: 1) */
  n?: number;
  /** Image quality */
  quality?: string;
  /** Input fidelity for GPT Image 1: high or low */
  input_fidelity?: 'high' | 'low';
  /** Background for GPT Image 1 */
  background?: 'auto' | 'transparent' | 'opaque';
  /** Output format for GPT Image 1 */
  output_format?: 'png' | 'jpeg' | 'webp';
  /** Compression level 0-100 for GPT Image 1 */
  output_compression?: number;
  /** Response format for DALL-E 2 */
  response_format?: 'url' | 'b64_json';
  /** User identifier for monitoring */
  user?: string;
}

/** Parameters for image variation */
export interface VariationImageParams {
  /** Image file path (required) */
  image: string;
  /** Model to use (only dall-e-2 supported) */
  model?: 'dall-e-2';
  /** Number of variations to generate (default: 1) */
  n?: number;
  /** Image size */
  size?: string;
  /** Response format */
  response_format?: 'url' | 'b64_json';
  /** User identifier for monitoring */
  user?: string;
}

/** Individual image data in API response */
export interface ImageData {
  /** URL of generated image (DALL-E 2/3) */
  url?: string;
  /** Base64 encoded image data (GPT Image 1, or when response_format=b64_json) */
  b64_json?: string;
  /** Revised prompt (DALL-E 3 may modify the original prompt) */
  revised_prompt?: string;
}

/** Usage information in API response */
export interface UsageInfo {
  /** Total tokens used */
  total_tokens?: number;
  /** Input tokens used */
  input_tokens?: number;
  /** Output tokens used */
  output_tokens?: number;
}

/** Image generation API response */
export interface ImageResponse {
  /** Unix timestamp when response was created */
  created: number;
  /** Array of generated image data */
  data: ImageData[];
  /** Usage information (GPT Image 1) */
  usage?: UsageInfo;
  /** Output format used */
  output_format?: string;
}

// =============================================================================
// Video Generation Types (Sora)
// =============================================================================

/** Parameters for video creation */
export interface CreateVideoParams {
  /** Text description of desired video (required) */
  prompt: string;
  /** Model to use (default: sora-2) */
  model?: VideoModel;
  /** Video resolution */
  size?: string;
  /** Video duration in seconds: 4, 8, or 12 */
  seconds?: number | string;
  /** Path to reference image for first frame */
  input_reference?: string;
}

/** Parameters for listing videos */
export interface ListVideosParams {
  /** Number of items to retrieve (default: 20) */
  limit?: number;
  /** Cursor for pagination (video ID) */
  after?: string;
  /** Sort order: asc or desc (default: desc) */
  order?: 'asc' | 'desc';
}

/** Video content download variant */
export type VideoVariant = 'video' | 'thumbnail' | 'spritesheet';

/** Video job status */
export type VideoStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

/** Error information in video object */
export interface VideoError {
  /** Error message */
  message?: string;
  /** Error code */
  code?: string;
}

/** Video job object from API */
export interface VideoObject {
  /** Unique video job ID */
  id: string;
  /** Object type (always 'video') */
  object: 'video';
  /** Unix timestamp when job was created */
  created_at: number;
  /** Current status of video generation */
  status: VideoStatus;
  /** Model used for generation */
  model: VideoModel;
  /** Generation progress percentage (0-100) */
  progress?: number;
  /** Video duration in seconds */
  seconds?: number;
  /** Video resolution */
  size?: string;
  /** Original prompt */
  prompt?: string;
  /** ID of video this was remixed from */
  remixed_from_video_id?: string;
  /** Error information if status is 'failed' */
  error?: VideoError;
}

/** Paginated list of videos response */
export interface ListVideosResponse {
  /** Object type (always 'list') */
  object: 'list';
  /** Array of video objects */
  data: VideoObject[];
  /** Whether there are more items */
  has_more?: boolean;
}

/** Options for polling video status */
export interface PollVideoOptions {
  /** Polling interval in milliseconds (default: 10000) */
  interval?: number;
  /** Maximum wait time in milliseconds (default: 600000) */
  timeout?: number;
  /** Whether to show CLI spinner (default: true) */
  showSpinner?: boolean;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

// =============================================================================
// Model Constraints
// =============================================================================

/** Range constraint with min/max values */
export interface RangeConstraint {
  min: number;
  max: number;
}

/** Image model parameter constraints */
export interface ImageModelConstraints {
  /** Valid image sizes */
  sizes: string[];
  /** Maximum prompt length in characters */
  promptMaxLength: number;
  /** Valid quality options */
  quality: string[];
  /** Range for n parameter */
  n: RangeConstraint;
  /** Whether model supports editing */
  supportsEdit: boolean;
  /** Whether model supports variations */
  supportsVariation: boolean;
  /** Valid response formats */
  responseFormats?: string[];
  /** Valid styles (DALL-E 3) */
  styles?: string[];
  /** Valid backgrounds (GPT Image 1) */
  backgrounds?: string[];
  /** Valid output formats (GPT Image 1) */
  outputFormats?: string[];
  /** Compression range (GPT Image 1) */
  outputCompression?: RangeConstraint;
  /** Partial images range (GPT Image 1) */
  partialImages?: RangeConstraint;
  /** Valid input fidelity options (GPT Image 1) */
  inputFidelity?: string[];
  /** Response format (GPT Image 1) */
  responseFormat?: string;
  /** Maximum image file size in bytes */
  imageMaxSize?: number;
  /** Image format requirements */
  imageRequirements?: string;
  /** Maximum images for editing */
  editMaxImages?: number;
  /** Valid image formats */
  imageFormats?: string[];
  /** Valid moderation levels */
  moderation?: string[];
}

/** Video model parameter constraints */
export interface VideoModelConstraints {
  /** Valid video sizes */
  sizes: string[];
  /** Valid durations in seconds */
  seconds: number[];
  /** Valid quality options */
  quality: string[];
  /** Maximum prompt length */
  promptMaxLength: number;
  /** Polling interval in seconds */
  pollInterval: number;
  /** Maximum wait time in seconds */
  timeout: number;
  /** Valid status values */
  statuses: VideoStatus[];
  /** Valid content variants */
  variants: VideoVariant[];
  /** Whether model supports input reference images */
  supportsInputReference: boolean;
  /** Whether model supports remix */
  supportsRemix: boolean;
  /** Maximum video file size in bytes */
  videoMaxSize: number;
  /** Maximum input reference image size */
  imageReferenceMaxSize: number;
  /** Valid input reference image formats */
  imageReferenceFormats: string[];
}

/** Map of image model names to constraints */
export type ImageModelConstraintsMap = {
  [K in ImageModel]: ImageModelConstraints;
};

/** Map of video model names to constraints */
export type VideoModelConstraintsMap = {
  [K in VideoModel]: VideoModelConstraints;
};

// =============================================================================
// Validation Types
// =============================================================================

/** Result of parameter validation */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Array of error messages if validation failed */
  errors: string[];
}

/** Image file validation constraints */
export interface ImageFileConstraints {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Valid file formats (extensions without dot) */
  formats?: string[];
}

/** Video file validation constraints */
export interface VideoFileConstraints {
  /** Maximum file size in bytes */
  maxSize?: number;
}

// =============================================================================
// Utility Types
// =============================================================================

/** CLI spinner interface */
export interface Spinner {
  /** Start the spinner animation */
  start(): Spinner;
  /** Update the spinner message */
  update(message: string): Spinner;
  /** Stop spinner with success message */
  stop(finalMessage?: string): Spinner;
  /** Stop spinner with failure message */
  fail(errorMessage?: string): Spinner;
}

/** Video metadata for saving to file */
export interface VideoMetadata {
  /** Video ID */
  id: string;
  /** Object type */
  object: string;
  /** Creation timestamp */
  created_at: number;
  /** Video status */
  status: VideoStatus;
  /** Model used */
  model: VideoModel;
  /** Progress percentage */
  progress?: number;
  /** Duration in seconds */
  seconds?: number;
  /** Video resolution */
  size?: string;
  /** Generation prompt */
  prompt?: string;
  /** Source video ID for remixes */
  remixed_from_video_id?: string;
  /** Error information */
  error?: VideoError;
  /** Metadata save timestamp */
  timestamp: string;
}

/** Options for saving video files */
export interface SaveVideoOptions {
  /** Maximum allowed file size in bytes */
  maxSize?: number;
}

/** Request options for API calls */
export interface RequestOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Response type for binary data */
  responseType?: 'arraybuffer' | 'json';
}

// =============================================================================
// Re-export Logger type for convenience
// =============================================================================

export type { Logger };
