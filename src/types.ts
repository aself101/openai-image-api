/**
 * OpenAI Image API Type Definitions
 *
 * Type definitions for the OpenAI Image API (`/v1/images/generations`,
 * `/v1/images/edits`) as served to the GPT Image model family.
 *
 * Scope decisions recorded here (3.0.0, 2026-09-20):
 * - DALL-E 2/3 were shut down by OpenAI on 2026-05-12 and are not modelled.
 *   The `/v1/images/variations` endpoint only ever accepted `dall-e-2`, so it
 *   is gone with them; likewise `response_format`, `style`, and URL responses.
 * - The Videos API (Sora 2) shuts down 2026-09-24 and is not modelled.
 * - `gpt-image-1`, `gpt-image-1-mini`, and `gpt-image-1.5` have announced
 *   shutdown dates (see MODEL_DEPRECATIONS in config.ts) and remain supported
 *   until then.
 */

import type { Logger } from 'winston';

// =============================================================================
// Model Types
// =============================================================================

/**
 * Canonical GPT Image model families. Constraints are keyed by family; dated
 * snapshots resolve to their family via MODEL_ALIASES.
 */
export type ImageModelFamily =
  | 'gpt-image-2.5-sunburst'
  | 'gpt-image-2.5-flare'
  | 'gpt-image-2'
  | 'gpt-image-1.5'
  | 'gpt-image-1'
  | 'gpt-image-1-mini';

/** Dated model snapshots accepted by the API. */
export type ImageModelSnapshot =
  | 'gpt-image-2.5-sunburst-2026-09-08'
  | 'gpt-image-2.5-flare-2026-09-08'
  | 'gpt-image-2-2026-04-21';

/** Any model identifier this package will send to the API. */
export type ImageModel = ImageModelFamily | ImageModelSnapshot;

/** Log level options */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

// =============================================================================
// Parameter Enumerations
// =============================================================================

/** Rendering quality. `xhigh` and `max` are accepted only by the 2.5 models. */
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Background handling. `transparent` requires `png` or `webp` output. */
export type ImageBackground = 'auto' | 'transparent' | 'opaque';

/** Encoded output format */
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

/** Content-moderation strictness */
export type ImageModeration = 'auto' | 'low';

/**
 * How strongly edits preserve input-image detail. Accepted only by the
 * gpt-image-1.x models; gpt-image-2 and the 2.5 models reject it and always
 * process inputs at high fidelity.
 */
export type InputFidelity = 'high' | 'low';

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
  /**
   * Per-request timeout in milliseconds (default: 180000).
   *
   * Image generation is slow: the guide states complex prompts can take up to
   * two minutes, and `max` quality at 4K sizes runs longer. The 30 s default
   * shipped in 2.1.0 aborted ordinary high-quality requests.
   */
  requestTimeout?: number;
}

// =============================================================================
// Image Generation Types
// =============================================================================

/** Parameters shared by generation and edit requests */
export interface CommonImageParams {
  /** Model to use (default: gpt-image-2.5-flare) */
  model?: ImageModel;
  /**
   * Image size as `WIDTHxHEIGHT` or `auto`.
   *
   * gpt-image-1 / 1-mini / 1.5: one of 1024x1024, 1536x1024, 1024x1536, auto.
   * gpt-image-2 / 2.5: any size with both edges divisible by 16, aspect ratio
   * between 1:3 and 3:1, no edge above 3840 px, and total pixels between
   * 655,360 and 8,294,400. Resolutions above 2560x1440 are experimental.
   */
  size?: string;
  /** Rendering quality (default: auto) */
  quality?: ImageQuality;
  /** Number of images to generate, 1-10 (default: 1) */
  n?: number;
  /** Background handling (default: auto) */
  background?: ImageBackground;
  /** Output encoding (default: png) */
  output_format?: ImageOutputFormat;
  /** Compression 0-100 for jpeg/webp output (default: 100) */
  output_compression?: number;
  /** Moderation strictness (default: auto) */
  moderation?: ImageModeration;
  /** End-user identifier for abuse monitoring */
  user?: string;
}

/** Parameters for image generation */
export interface GenerateImageParams extends CommonImageParams {
  /** Text description of desired image (required, max 32,000 characters) */
  prompt: string;
}

/** Parameters for image editing */
export interface EditImageParams extends CommonImageParams {
  /** Image file path(s) for editing; up to 16 images */
  image: string | string[];
  /** Text description of desired edit (required) */
  prompt: string;
  /** Mask image file path (optional). Transparent areas mark the edit region. */
  mask?: string;
  /** Input fidelity. Accepted by gpt-image-1.x only. */
  input_fidelity?: InputFidelity;
}

/** Additional parameters accepted by streaming requests */
export interface StreamParams {
  /**
   * Number of partial images to emit before the final one (0-3, default 0).
   * Each partial image costs an additional 100 image output tokens. The final
   * image may arrive before all requested partials if generation is fast.
   */
  partial_images?: number;
}

/** Parameters for streaming image generation */
export type StreamImageParams = GenerateImageParams & StreamParams;

/** Parameters for streaming image editing */
export type StreamEditImageParams = EditImageParams & StreamParams;

/** Individual image data in API response */
export interface ImageData {
  /** Base64 encoded image data. GPT Image models always return base64. */
  b64_json?: string;
  /** Revised prompt, when the model rewrote the input */
  revised_prompt?: string;
}

/** Token breakdown by modality */
export interface TokenDetails {
  /** Image tokens */
  image_tokens?: number;
  /** Text tokens */
  text_tokens?: number;
}

/** Usage information in API response */
export interface UsageInfo {
  /** Total tokens used */
  total_tokens?: number;
  /** Input tokens used (text prompt plus any input images) */
  input_tokens?: number;
  /** Output tokens used */
  output_tokens?: number;
  /** Input token breakdown */
  input_tokens_details?: TokenDetails;
  /** Output token breakdown */
  output_tokens_details?: TokenDetails;
}

/** Image generation / edit API response */
export interface ImageResponse {
  /** Unix timestamp when response was created */
  created: number;
  /** Array of generated image data */
  data: ImageData[];
  /** Token usage */
  usage?: UsageInfo;
  /** Output format used */
  output_format?: ImageOutputFormat;
  /** Quality used */
  quality?: ImageQuality;
  /** Size used */
  size?: string;
  /** Background used */
  background?: ImageBackground;
}

// =============================================================================
// Streaming Event Types
// =============================================================================

/** Fields common to every image streaming event */
interface ImageStreamEventBase {
  /** Base64 encoded image data (partial or final) */
  b64_json: string;
  /** Background setting in effect */
  background?: ImageBackground;
  /** Unix timestamp when the event was created */
  created_at: number;
  /** Output format in effect */
  output_format?: ImageOutputFormat;
  /** Quality setting in effect */
  quality?: ImageQuality;
  /** Size in effect */
  size?: string;
  /** Monotonic position of this event within the stream */
  sequence_number?: number;
}

/** Partial frame emitted during generation */
export interface ImageGenerationPartialImageEvent extends ImageStreamEventBase {
  type: 'image_generation.partial_image';
  /** 0-based index of this partial frame */
  partial_image_index: number;
}

/** Final image emitted when generation completes */
export interface ImageGenerationCompletedEvent extends ImageStreamEventBase {
  type: 'image_generation.completed';
  /** Token usage for the request */
  usage?: UsageInfo;
}

/** Partial frame emitted during an edit */
export interface ImageEditPartialImageEvent extends ImageStreamEventBase {
  type: 'image_edit.partial_image';
  /** 0-based index of this partial frame */
  partial_image_index: number;
}

/** Final image emitted when an edit completes */
export interface ImageEditCompletedEvent extends ImageStreamEventBase {
  type: 'image_edit.completed';
  /** Token usage for the request */
  usage?: UsageInfo;
}

/** Any event from a streaming generation request */
export type ImageGenerationStreamEvent =
  | ImageGenerationPartialImageEvent
  | ImageGenerationCompletedEvent;

/** Any event from a streaming edit request */
export type ImageEditStreamEvent = ImageEditPartialImageEvent | ImageEditCompletedEvent;

/** Any image streaming event */
export type ImageStreamEvent = ImageGenerationStreamEvent | ImageEditStreamEvent;

/** Partial-image event of either kind */
export type ImagePartialImageEvent = ImageGenerationPartialImageEvent | ImageEditPartialImageEvent;

/** Callbacks for the convenience streaming wrappers */
export interface StreamHandlers {
  /** Invoked for each partial frame, in index order */
  onPartialImage?: (event: ImagePartialImageEvent) => void | Promise<void>;
}

/** A raw Server-Sent Event as parsed off the wire */
export interface RawSSEEvent {
  /** `event:` field, if present */
  event?: string;
  /** Concatenated `data:` lines */
  data: string;
}

// =============================================================================
// Model Constraints
// =============================================================================

/** Range constraint with min/max values */
export interface RangeConstraint {
  min: number;
  max: number;
}

/**
 * Free-form size rules for models that accept arbitrary WIDTHxHEIGHT strings.
 * Values are those published in the API reference for gpt-image-2 / 2.5.
 */
export interface FlexibleSizeConstraint {
  /** Both edges must be divisible by this */
  multipleOf: number;
  /** Neither edge may exceed this */
  maxEdge: number;
  /** Long edge / short edge may not exceed this */
  maxAspectRatio: number;
  /** Total pixel count bounds */
  pixels: RangeConstraint;
  /** Resolutions with more pixels than this are documented as experimental */
  experimentalAbovePixels: number;
}

/** Image model parameter constraints */
export interface ImageModelConstraints {
  /**
   * Enumerated valid sizes. For flexible-size models these are the documented
   * standard sizes; any string passing `flexibleSize` is also valid.
   */
  sizes: string[];
  /** Free-form size rules, when the model accepts them */
  flexibleSize?: FlexibleSizeConstraint;
  /** Maximum prompt length in characters */
  promptMaxLength: number;
  /** Valid quality options */
  quality: ImageQuality[];
  /** Range for n parameter */
  n: RangeConstraint;
  /** Whether model supports editing */
  supportsEdit: boolean;
  /** Valid backgrounds */
  backgrounds: ImageBackground[];
  /** Valid output formats */
  outputFormats: ImageOutputFormat[];
  /** Compression range */
  outputCompression: RangeConstraint;
  /** Partial images range */
  partialImages: RangeConstraint;
  /** Valid input fidelity options; undefined means the parameter is rejected */
  inputFidelity?: InputFidelity[];
  /** Maximum image file size in bytes */
  imageMaxSize: number;
  /** Maximum images per edit request */
  editMaxImages: number;
  /** Valid input image formats (extensions without dot) */
  imageFormats: string[];
  /** Valid moderation levels */
  moderation: ImageModeration[];
}

/** Map of image model families to constraints */
export type ImageModelConstraintsMap = {
  [K in ImageModelFamily]: ImageModelConstraints;
};

/** Announced shutdown for a model */
export interface ModelDeprecation {
  /** ISO date the model is removed from the API */
  shutdown: string;
  /** Model OpenAI recommends migrating to */
  replacement: ImageModelFamily;
}

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

/** Request options for API calls */
export interface RequestOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

// =============================================================================
// Re-export Logger type for convenience
// =============================================================================

export type { Logger };
