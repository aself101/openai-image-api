/**
 * OpenAI Image Service Utility Functions
 *
 * Utility functions for OpenAI image generation, including file I/O,
 * image handling, and data transformations.
 */
import type { Spinner, ImageFileConstraints, VideoFileConstraints, VideoObject, SaveVideoOptions, PollVideoOptions, ValidationResult, Logger } from './types.js';
declare const logger: Logger;
/**
 * Set the logging level.
 *
 * @param level - Log level (DEBUG, INFO, WARNING, ERROR)
 */
export declare function setLogLevel(level: string): void;
export { logger };
/**
 * Validate URL for security (prevent SSRF attacks).
 *
 * DNS Resolution: This function performs DNS resolution to prevent DNS rebinding attacks,
 * where a domain might resolve to different IPs between validation time and request time.
 *
 * @param url - URL to validate
 * @returns The validated URL
 * @throws Error If URL is invalid or points to blocked resource
 */
export declare function validateImageUrl(url: string): Promise<string>;
/**
 * Validate that file exists and is a valid image file.
 *
 * @param filepath - Path to image file
 * @returns The validated filepath
 * @throws Error If file doesn't exist or is not a valid image
 */
export declare function validateImagePath(filepath: string): Promise<string>;
/**
 * Validate output path for path traversal attacks.
 *
 * @param outputPath - Path to validate
 * @param basePath - Optional base path that output must be within
 * @returns The resolved absolute path
 * @throws Error if path contains traversal sequences or escapes base path
 */
export declare function validateOutputPath(outputPath: string, basePath?: string): string;
/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param dirPath - Directory path to ensure
 */
export declare function ensureDirectory(dirPath: string): Promise<void>;
/** File format for writeToFile */
type FileFormat = 'json' | 'txt' | 'binary' | 'auto';
/**
 * Write data to file.
 *
 * @param data - Data to write (Object, Array, Buffer, string, etc.)
 * @param filepath - Path where file should be written
 * @param fileFormat - Format to use ('json', 'txt', 'binary', 'auto')
 */
export declare function writeToFile(data: unknown, filepath: string, fileFormat?: FileFormat): Promise<void>;
/**
 * Convert local image file or URL to base64 data URI.
 *
 * @param input - Local file path or URL
 * @returns Base64 data URI (data:image/png;base64,...)
 */
export declare function imageToBase64(input: string): Promise<string>;
/**
 * Download image from URL and save to file.
 *
 * @param url - Image URL
 * @param filepath - Destination file path
 * @returns The filepath where image was saved
 */
export declare function downloadImage(url: string, filepath: string): Promise<string>;
/**
 * Decode base64 image data and save to file.
 *
 * @param b64Data - Base64 encoded image data
 * @param filepath - Destination file path
 * @returns The filepath where image was saved
 */
export declare function decodeBase64Image(b64Data: string, filepath: string): Promise<string>;
/**
 * Sanitize text for use in filenames.
 *
 * @param text - Text to sanitize
 * @param maxLength - Maximum length of sanitized text
 * @returns Sanitized text safe for filenames
 */
export declare function sanitizeForFilename(text: string, maxLength?: number): string;
/**
 * Generate filename from prompt text.
 *
 * @param prompt - The image generation prompt
 * @param maxLength - Maximum length of filename part
 * @returns Sanitized filename-safe string
 */
export declare function promptToFilename(prompt: string, maxLength?: number): string;
/**
 * Generate timestamped filename with prompt.
 *
 * @param prompt - The image generation prompt
 * @param model - Model name (dalle-2, dalle-3, gpt-image-1)
 * @param extension - File extension (png, jpg, webp)
 * @returns Timestamped filename
 */
export declare function generateTimestampedFilename(prompt: string, model: string, extension?: string): string;
/**
 * Validate image file.
 *
 * @param filepath - Path to image file
 * @param constraints - Validation constraints
 * @returns Validation result with valid flag and errors array
 */
export declare function validateImageFile(filepath: string, constraints?: ImageFileConstraints): ValidationResult;
/**
 * Pause execution for specified time.
 *
 * @param seconds - Number of seconds to pause
 */
export declare function pause(seconds: number): Promise<void>;
/**
 * Create a simple text-based spinner for CLI.
 *
 * @param message - Message to display
 * @returns Spinner object with update() and stop() methods
 */
export declare function createSpinner(message?: string): Spinner;
/** Interface for video API with retrieveVideo method */
interface VideoAPIInterface {
    retrieveVideo(videoId: string, options?: {
        signal?: AbortSignal;
    }): Promise<VideoObject>;
}
/**
 * Poll video status with progress display.
 *
 * @param api - OpenAIVideoAPI instance
 * @param videoId - Video job ID
 * @param options - Polling options
 * @returns Completed video object
 * @throws Error If video generation fails, times out, or is cancelled
 */
export declare function pollVideoWithProgress(api: VideoAPIInterface, videoId: string, options?: PollVideoOptions): Promise<VideoObject>;
/**
 * Save video buffer to MP4 file.
 *
 * @param buffer - Video data buffer
 * @param filepath - Destination file path
 * @param options - Save options
 * @returns Path to saved file
 * @throws Error If buffer is invalid or exceeds size limit
 */
export declare function saveVideoFile(buffer: Buffer, filepath: string, options?: SaveVideoOptions): Promise<string>;
/**
 * Generate timestamped filename for video.
 *
 * @param prompt - The video generation prompt
 * @param model - Model name (sora-2, sora-2-pro)
 * @param extension - File extension (mp4, webp, jpg)
 * @returns Timestamped filename
 */
export declare function generateVideoFilename(prompt: string, model: string, extension?: string): string;
/**
 * Save video metadata as JSON file.
 *
 * @param videoObject - Video object from API
 * @param filepath - Path to save metadata JSON
 * @returns Path to saved metadata file
 */
export declare function saveVideoMetadata(videoObject: VideoObject, filepath: string): Promise<string>;
/**
 * Validate video file from download.
 *
 * @param buffer - Video buffer to validate
 * @param constraints - Validation constraints
 * @returns Validation result with valid flag and errors array
 */
export declare function validateVideoFile(buffer: Buffer, constraints?: VideoFileConstraints): ValidationResult;
//# sourceMappingURL=utils.d.ts.map