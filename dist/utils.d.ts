/**
 * OpenAI Image Service Utility Functions
 *
 * Utility functions for OpenAI image generation, including file I/O,
 * image handling, SSRF-safe URL validation, SSE parsing, and data
 * transformations.
 */
import type { Readable } from 'stream';
import type { Spinner, ImageFileConstraints, ValidationResult, Logger, RawSSEEvent } from './types.js';
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
 * @param model - Model name (e.g. gpt-image-2.5-flare)
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
/**
 * Parse a Server-Sent Events byte stream into discrete events.
 *
 * Implements the subset of the SSE wire format the Image API emits: events are
 * separated by a blank line, each carrying an `event:` line and one or more
 * `data:` lines. Comment lines (`:`) and unknown fields are ignored. A trailing
 * event with no terminating blank line is flushed when the stream ends, so a
 * server that closes the connection immediately after the final event is not
 * mis-read as having sent nothing.
 *
 * Image payloads are large (a `max`-quality PNG is several megabytes of base64
 * in a single `data:` line), so chunks are accumulated as strings and only
 * split on the event delimiter; no per-line buffering limit is imposed.
 *
 * @param stream - Readable emitting UTF-8 SSE bytes
 * @returns Async generator of raw events in arrival order
 */
export declare function parseSSEStream(stream: Readable): AsyncGenerator<RawSSEEvent>;
/**
 * Read an entire stream into a UTF-8 string.
 *
 * Used to recover an error body when a streaming request fails: axios hands
 * back `response.data` as a Readable in stream mode, so the JSON error the API
 * returned must be drained before it can be reported.
 *
 * @param stream - Readable to drain
 * @param maxBytes - Refuse to buffer more than this (default 1 MiB)
 */
export declare function readStreamToString(stream: Readable, maxBytes?: number): Promise<string>;
//# sourceMappingURL=utils.d.ts.map