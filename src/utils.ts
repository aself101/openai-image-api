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
import path from 'path';
import { randomBytes } from 'crypto';
import winston from 'winston';
import type { Readable } from 'stream';
import type { Spinner, Logger, RawSSEEvent } from './types.js';

// Configure module logger
const logger: Logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

/**
 * Set the logging level.
 *
 * @param level - Log level (DEBUG, INFO, WARNING, ERROR)
 */
export function setLogLevel(level: string): void {
  logger.level = level.toLowerCase();
}

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
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/**
 * Extract a Node errno code from a caught value, if it carries one.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Validate that a file exists, is non-empty, is within a size limit, and
 * carries the magic bytes of a format the Image API accepts (PNG, JPEG, WebP).
 *
 * Only the first 12 bytes are read: a 50 MB input costs one small read, not a
 * whole-file buffer per image. GIF is not accepted — the API's documented
 * input formats are png, webp, jpg.
 *
 * @param filepath - Path to image file
 * @param maxSize - Maximum file size in bytes (default 50 MB, the API limit)
 * @returns The validated filepath
 * @throws Error If the file is missing, unreadable, empty, too large, or not an image
 */
export async function validateImagePath(filepath: string, maxSize: number = 50 * 1024 * 1024): Promise<string> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filepath, 'r');
    const { size } = await handle.stat();

    if (size === 0) {
      throw new Error(`Image file is empty: ${filepath}`);
    }
    if (size > maxSize) {
      const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
      throw new Error(`Image file ${filepath} is ${mb(size)}MB; the limit is ${mb(maxSize)}MB`);
    }

    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    const magic = header.subarray(0, bytesRead);

    const isPNG = magic.length >= 4 && magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47;
    const isJPEG = magic.length >= 3 && magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
    const isWebP = magic.length >= 12 && magic.subarray(0, 4).toString() === 'RIFF' && magic.subarray(8, 12).toString() === 'WEBP';

    if (!isPNG && !isJPEG && !isWebP) {
      throw new Error(`File does not appear to be a valid image (PNG, JPEG, or WebP): ${filepath}`);
    }

    return filepath;
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
      throw new Error(`Image file not found: ${filepath}`, { cause: error });
    } else if (code === 'EACCES') {
      throw new Error(`Permission denied reading image file: ${filepath}`, { cause: error });
    } else if (code === 'EISDIR') {
      throw new Error(`Image path is a directory, not a file: ${filepath}`, { cause: error });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Validate output path for path traversal attacks.
 *
 * @param outputPath - Path to validate
 * @param basePath - Optional base path that output must be within
 * @returns The resolved absolute path
 * @throws Error if path contains traversal sequences or escapes base path
 */
export function validateOutputPath(outputPath: string, basePath?: string): string {
  // Reject a `..` path SEGMENT, not the substring: `my..dir` is a legal name.
  // Both separators are split on so a Windows-style path is checked the same way.
  if (outputPath.split(/[\\/]+/).includes('..')) {
    throw new Error('Path traversal sequences (..) are not allowed in output paths');
  }

  // Resolve to absolute path
  const resolved = path.resolve(outputPath);

  // If base path provided, ensure output stays within it
  if (basePath) {
    const resolvedBase = path.resolve(basePath);
    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
      throw new Error(`Output path must be within ${basePath}`);
    }
  }

  return resolved;
}

/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param dirPath - Directory path to ensure
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error(`Error creating directory ${dirPath}: ${message}`);
    throw error;
  }
}

/** File format for writeToFile */
type FileFormat = 'json' | 'txt' | 'binary' | 'auto';

/**
 * Write data to file.
 *
 * @param data - Data to write (Object, Array, Buffer, string, etc.)
 * @param filepath - Path where file should be written
 * @param fileFormat - Format to use ('json', 'txt', 'binary', 'auto')
 */
export async function writeToFile(
  data: unknown,
  filepath: string,
  fileFormat: FileFormat = 'auto'
): Promise<void> {
  if (!filepath) {
    throw new Error('Filepath is required');
  }

  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    // Auto-detect format from extension
    let format = fileFormat;
    if (format === 'auto') {
      const ext = path.extname(filepath).toLowerCase();
      if (ext === '.json') {
        format = 'json';
      } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        format = 'binary';
      } else {
        format = 'txt';
      }
    }

    // Write based on format
    if (format === 'json') {
      await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    } else if (format === 'binary') {
      if (!Buffer.isBuffer(data)) {
        throw new Error(`Binary write to ${filepath} requires a Buffer, got ${typeof data}`);
      }
      await fs.writeFile(filepath, data);
    } else {
      await fs.writeFile(filepath, String(data));
    }

    logger.debug(`Wrote file: ${filepath}`);
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error(`Error writing file ${filepath}: ${message}`);
    throw error;
  }
}

/**
 * Decode base64 image data and save to file.
 *
 * @param b64Data - Base64 encoded image data
 * @param filepath - Destination file path
 * @returns The filepath where image was saved
 */
export async function decodeBase64Image(b64Data: string, filepath: string): Promise<string> {
  try {
    logger.debug(`Decoding base64 image to ${filepath}`);

    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    const buffer = Buffer.from(b64Data, 'base64');
    await fs.writeFile(filepath, buffer);

    logger.info(`Saved base64 image: ${filepath}`);
    return filepath;
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error(`Error decoding base64 image: ${message}`);
    throw new Error(`Failed to decode base64 image: ${message}`, { cause: error });
  }
}

/**
 * Sanitize text for use in filenames.
 *
 * @param text - Text to sanitize
 * @param maxLength - Maximum length of sanitized text
 * @returns Sanitized text safe for filenames
 */
export function sanitizeForFilename(text: string, maxLength: number = 50): string {
  // Letters and digits in any script are kept, so a Japanese or Cyrillic prompt
  // does not collapse to an empty stem; everything else becomes one underscore.
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, maxLength);
}

/**
 * Generate filename from prompt text.
 *
 * @param prompt - The image generation prompt
 * @param maxLength - Maximum length of filename part
 * @returns Sanitized filename-safe string
 */
export function promptToFilename(prompt: string, maxLength: number = 50): string {
  return sanitizeForFilename(prompt, maxLength);
}

/**
 * Generate timestamped filename with prompt.
 *
 * @param prompt - The image generation prompt
 * @param model - Model name (e.g. gpt-image-2.5-flare)
 * @param extension - File extension (png, jpg, webp)
 * @returns Timestamped filename
 */
export function generateTimestampedFilename(
  prompt: string,
  model: string,
  extension: string = 'png'
): string {
  // ISO 8601 is always "YYYY-MM-DDTHH:MM:SS.mmmZ"; keep date, HH-MM-SS and ms.
  // Millisecond resolution plus a 4-hex random tail keeps two processes that
  // render the same prompt in the same second from overwriting each other.
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const timestamp = `${iso.slice(0, 10)}_${iso.slice(11, 23)}`;
  const nonce = randomBytes(2).toString('hex');
  const promptPart = promptToFilename(prompt, 40) || 'prompt';
  return `${timestamp}_${nonce}_${model}_${promptPart}.${extension}`;
}

/**
 * Create a simple text-based spinner for CLI.
 *
 * @param message - Message to display
 * @returns Spinner object with update() and stop() methods
 */
export function createSpinner(message: string = 'Processing'): Spinner {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  const startTime = Date.now();
  let currentMessage = message;

  const spinner: Spinner = {
    start() {
      process.stdout.write('\n');
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const frame = frames[frameIndex];
        frameIndex = (frameIndex + 1) % frames.length;

        process.stdout.write(`\r${frame} ${currentMessage}... (${elapsed}s elapsed)`);
      }, 80);
      return this;
    },

    update(newMessage: string) {
      currentMessage = newMessage;
      return this;
    },

    stop(finalMessage: string | undefined = undefined) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (finalMessage) {
        process.stdout.write(`\r✓ ${finalMessage} (${elapsed}s)\n`);
      } else {
        process.stdout.write(`\r✓ ${currentMessage} complete (${elapsed}s)\n`);
      }

      return this;
    },

    fail(errorMessage: string | undefined = undefined) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }

      if (errorMessage) {
        process.stdout.write(`\r✗ ${errorMessage}\n`);
      } else {
        process.stdout.write(`\r✗ ${currentMessage} failed\n`);
      }

      return this;
    },
  };

  return spinner;
}

// =============================================================================
// SERVER-SENT EVENTS
// =============================================================================

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
export async function* parseSSEStream(stream: Readable): AsyncGenerator<RawSSEEvent> {
  let buffer = '';
  // Where the next boundary search starts. Without it every chunk rescans the
  // whole buffer, which is quadratic on a multi-megabyte single-line payload;
  // backing up three characters covers a delimiter split across chunks.
  let scanFrom = 0;

  const flush = (block: string): RawSSEEvent | null => {
    let event: string | undefined;
    const data: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      // The spec strips exactly one leading space after the colon
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length === 0 && event === undefined) return null;
    return { event, data: data.join('\n') };
  };

  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');

    // Events end at a blank line; tolerate CRLF, LF, and a mixed pair
    const delimiter = /\r?\n\r?\n/g;
    delimiter.lastIndex = Math.max(0, scanFrom - 3);
    let match: RegExpExecArray | null;
    while ((match = delimiter.exec(buffer)) !== null) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      delimiter.lastIndex = 0;
      const parsed = flush(block);
      if (parsed) yield parsed;
    }
    scanFrom = buffer.length;
  }

  if (buffer.trim().length > 0) {
    const parsed = flush(buffer);
    if (parsed) yield parsed;
  }
}

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
export async function readStreamToString(stream: Readable, maxBytes: number = 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`Stream exceeded ${maxBytes} bytes while reading error body`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
