/**
 * OpenAI Image Service Utility Functions
 *
 * Utility functions for OpenAI image generation: file I/O, input-image and
 * output-path validation, SSE parsing, filename generation, and the CLI
 * spinner.
 *
 * Removed in 3.0.0: `validateImageUrl`, `downloadImage`, `imageToBase64`,
 * `validateImageFile`, `pause`. The first three existed to fetch DALL-E
 * `url`-format responses; GPT Image models return base64 only, so the package
 * no longer performs any outbound fetch other than the API call itself, and the
 * SSRF guard that protected those fetches went with them. The last two had no
 * caller in any released version.
 */
import fs from 'fs/promises';
import type { Readable } from 'stream';
import type { Spinner, Logger, RawSSEEvent } from './types.js';
declare const logger: Logger;
/**
 * Set the logging level.
 *
 * @param level - Log level (DEBUG, INFO, WARNING, ERROR)
 */
export declare function setLogLevel(level: string): void;
/**
 * Map this package's LogLevel names to winston's npm levels.
 *
 * winston has `warn`, not `warning`. Assigning an unknown level name to a
 * winston logger does not fall back — it silences every transport, errors
 * included. Through 3.0.0 `logLevel: 'WARNING'` (the documented value, and
 * the library default since 3.0.0) did exactly that. Every logger in this
 * package must go through this function.
 *
 * @param level - DEBUG | INFO | WARNING | WARN | ERROR, any case
 * @returns The winston level string
 * @throws Error For a name that is none of those, rather than silently muting
 */
export declare function toWinstonLevel(level: string): 'debug' | 'info' | 'warn' | 'error';
/** Module-level logger shared by the CLI and utilities; level set via setLogLevel */
export { logger };
/**
 * Extract a printable message from whatever was thrown.
 *
 * `catch (error)` binds `unknown` under strict mode; casting it to `Error`
 * crashes inside the error handler if a dependency throws a string or null.
 *
 * @param error - The caught value
 * @returns The Error's message, or the value stringified
 */
export declare function getErrorMessage(error: unknown): string;
/**
 * Extract a Node errno code from a caught value, if it carries one.
 */
export declare function getErrorCode(error: unknown): string | undefined;
/** An input image that has passed the pre-upload checks, held open for upload */
export interface ValidatedImage {
    /** Open read handle; upload from this, not from the path, so the bytes checked are the bytes sent */
    handle: fs.FileHandle;
    /** Size in bytes (from the same open handle) */
    size: number;
    /** Detected media type from the magic bytes */
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    /** Header-safe multipart filename derived from the path */
    filename: string;
    /** The path as supplied, for messages */
    path: string;
}
/**
 * Open an input image and check it is non-empty, within the size limit, and
 * carries the magic bytes of a format the Image API accepts (PNG, JPEG, WebP).
 *
 * The handle is returned OPEN so the caller can upload from it. Doing the
 * check and the read on one descriptor closes the window in which a path
 * could be swapped between validation and upload. The caller owns the handle:
 * close it, or read it to the end through a stream created with autoClose.
 *
 * Only the first 12 bytes are read for the check. GIF is not accepted — the
 * API's documented input formats are png, webp, jpg.
 *
 * @param filepath - Path to image file
 * @param maxSize - Maximum file size in bytes (default 50 MB, the API limit)
 * @returns The open, validated image
 * @throws Error If the file is missing, unreadable, a directory, empty, too large, or not an image
 */
export declare function openValidatedImage(filepath: string, maxSize?: number): Promise<ValidatedImage>;
/**
 * Validate that a file exists, is non-empty, is within a size limit, and is a
 * PNG, JPEG or WebP — then close it. Use openValidatedImage() when the bytes
 * will be uploaded, so the check and the upload share one descriptor.
 *
 * @param filepath - Path to image file
 * @param maxSize - Maximum file size in bytes (default 50 MB, the API limit)
 * @returns The validated filepath
 * @throws Error If the file is missing, unreadable, empty, too large, or not an image
 */
export declare function validateImagePath(filepath: string, maxSize?: number): Promise<string>;
/**
 * Close a validated image's handle, tolerating one that a stream has already
 * closed (autoClose) — the second close rejects with EBADF and that is fine.
 *
 * @param image - The image to release
 */
export declare function closeValidatedImage(image: ValidatedImage): Promise<void>;
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
 * @param filepath - Path where file should be written (no `..` segments)
 * @param fileFormat - Format to use ('json', 'txt', 'binary', 'auto')
 * @throws Error If the path contains a `..` segment, or a binary write is given a non-Buffer
 * @example
 * await writeToFile({ model, prompt, usage }, 'out/render_metadata.json'); // 'auto' → JSON
 */
export declare function writeToFile(data: unknown, filepath: string, fileFormat?: FileFormat): Promise<void>;
/**
 * Decode base64 image data and save to file.
 *
 * `filepath` is passed through validateOutputPath first: a `..` segment is
 * refused, and the returned path is the resolved absolute path that was
 * written. Callers who build the path from untrusted input still own the
 * decision of which directory it lands in; `saveImages()` adds the
 * single-component check on the filename.
 *
 * @param b64Data - Base64 encoded image data
 * @param filepath - Destination file path (no `..` segments)
 * @returns The resolved path the image was written to
 * @throws Error If the path contains a `..` segment or the write fails
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
 * Assert that a caller-supplied base filename is a single path component.
 *
 * `saveImages()` joins this with the output directory; a value carrying a
 * separator or `..` would let a server that forwards end-user input into the
 * SDK write outside the directory it chose. Rejected rather than sanitized so
 * the caller learns about it.
 *
 * @param name - Proposed base filename (without extension)
 * @returns The same name
 * @throws Error If the name is empty, contains a path separator, or is `.`/`..`
 */
export declare function assertSafeBaseFilename(name: string): string;
/**
 * Multipart part filename derived from a path: the basename with CR, LF and
 * double quotes replaced, so a hostile path cannot inject header lines into
 * the multipart body regardless of the form-data version in use.
 *
 * @param filePath - Path of the file being uploaded
 * @returns A header-safe filename
 */
export declare function multipartFilename(filePath: string): string;
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
 * @returns `YYYY-MM-DD_HH-MM-SS-mmm_<4 hex>_<model>_<prompt stem>.<extension>`
 * @example
 * generateTimestampedFilename('A cat!', 'gpt-image-2', 'webp');
 * // → '2026-09-20_22-37-00-123_4f2a_gpt-image-2_a_cat.webp'
 */
export declare function generateTimestampedFilename(prompt: string, model: string, extension?: string): string;
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
 * split on the event delimiter. The accumulation is bounded: an event that
 * grows past `maxEventBytes` without a delimiter fails the stream instead of
 * growing until the process is out of memory — the bound is far above any real
 * image (128 MiB default, versus tens of MB for a 4K `max` render) and exists
 * for a hostile or broken upstream, not a legitimate one.
 *
 * @param stream - Readable emitting UTF-8 SSE bytes
 * @param maxEventBytes - Ceiling on a single undelimited event (default 128 MiB)
 * @returns Async generator of raw events in arrival order
 * @throws Error If one event exceeds maxEventBytes
 */
export declare const SSE_MAX_EVENT_BYTES: number;
export declare function parseSSEStream(stream: Readable, maxEventBytes?: number): AsyncGenerator<RawSSEEvent>;
/**
 * Read an entire stream into a UTF-8 string.
 *
 * Used to recover an error body when a streaming request fails: axios hands
 * back `response.data` as a Readable in stream mode, so the JSON error the API
 * returned must be drained before it can be reported.
 *
 * @param stream - Readable to drain
 * @param maxBytes - Refuse to buffer more than this (default 1 MiB)
 * @returns The stream's bytes decoded as UTF-8
 */
export declare function readStreamToString(stream: Readable, maxBytes?: number): Promise<string>;
//# sourceMappingURL=utils.d.ts.map